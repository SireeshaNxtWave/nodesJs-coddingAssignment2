const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const authenticateJwtToken = (request, response, next) => {
  let jwtToken;
  const authHeaders = request.headers["authorization"];

  if (authHeaders !== undefined) {
    jwtToken = authHeaders.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

const changeFeedsToCamelCase = (each) => {
  return {
    username: each.username,
    tweet: each.tweet,
    dateTime: each.date_time,
  };
};
// API 1
app.post("/register/", async (request, response) => {
  const { username, name, gender, password } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  const selectUserQuery = `SELECT * FROM user WHERE username='${username}'`;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const registerNewUser = `INSERT INTO user
                (username, name, password, gender)
                VALUES ('${username}', '${name}', '${hashedPassword}', '${gender}')`;
      await db.run(registerNewUser);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username='${username}'`;

  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get(
  "/user/tweets/feed/",
  authenticateJwtToken,
  async (request, response) => {
    const { username } = request;
    const selectUser = `
  SELECT user_id FROM user WHERE username='${username}'
  `;

    const loggedInUser = await db.get(selectUser);

    const selectTweets = `SELECT user.username, 
                    tweet.tweet, tweet.date_time FROM tweet INNER JOIN user 
                    ON  tweet.user_id = user.user_id
            WHERE user.user_id IN (SELECT following_user_id FROM
                follower WHERE follower_user_id=${loggedInUser.user_id})
            ORDER BY tweet.date_time DESC
            LIMIT 4`;

    const dbResponse = await db.all(selectTweets);
    response.send(dbResponse.map((each) => changeFeedsToCamelCase(each)));
  }
);

app.get("/user/following/", authenticateJwtToken, async (request, response) => {
  const { username } = request;
  const selectUser = `
  SELECT user_id FROM user WHERE username='${username}'
  `;

  const loggedInUser = await db.get(selectUser);

  const selectFollowingUsernames = `SELECT username AS name FROM user
                WHERE user_id IN (SELECT following_user_id FROM follower
                    WHERE follower_user_id = ${loggedInUser.user_id});`;

  const followingUserNames = await db.all(selectFollowingUsernames);
  response.send(followingUserNames);
});

app.get("/user/followers/", authenticateJwtToken, async (request, response) => {
  const { username } = request;
  const selectUser = `SELECT user_id FROM user WHERE username='${username}';`;

  const loggedInUser = await db.get(selectUser);

  const selectFollowerUserNames = `SELECT username AS name FROM user
                WHERE user_id IN (SELECT follower_user_id FROM follower
                        WHERE following_user_id = ${loggedInUser.user_id});`;

  const followerUsernames = await db.all(selectFollowerUserNames);
  response.send(followerUsernames);
});

app.get(
  "/tweets/:tweetId/",
  authenticateJwtToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    // console.log(tweetId);
    const selectTweetById = `SELECT * FROM tweet WHERE tweet_id=${tweetId};`;

    const tweetResult = await db.get(selectTweetById);
    //console.log(tweetResult);
    const selectUser = `SELECT user_id FROM user WHERE username='${username}';`;

    const loggedInUser = await db.get(selectUser);

    const userFollowersQuery = `
    SELECT 
    *
  FROM follower INNER JOIN user on user.user_id = follower.following_user_id
  WHERE follower.follower_user_id = ${loggedInUser.user_id};`;

    const userFollowers = await db.all(userFollowersQuery);
    //console.log(userFollowers);
    if (
      userFollowers.forEach(
        (item) => item.following_user_id === tweetResult.user_id
      )
    ) {
      response.send(item);
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/likes/",
  authenticateJwtToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;

    const selectUser = `SELECT user_id FROM user WHERE username='${username}';`;

    const loggedInUser = await db.get(selectUser);

    const selectUserIdFromFollower = `SELECT * FROM follower
                        WHERE follower_user_id=${loggedInUser.user_id} AND
                        following_user_id IN (SELECT user_id FROM tweet WHERE tweet_id=${tweetId})`;

    const checkUserIdByFollowingId = await db.all(selectUserIdFromFollower);
    //  console.log(checkUserIdByFollowingId);
    if (checkUserIdByFollowingId === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const selectWhoLiked = `SELECT username FROM user
                    WHERE user_id IN (SELECT user_id FROM like 
                        WHERE tweet_id=${tweetId});`;

      const dbResponse = await db.all(selectWhoLiked);
      // console.log(dbResponse);
      let likes = [];

      dbResponse.forEach((each) => {
        likes.push(each.username);
      });

      response.send({ likes });
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateJwtToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;

    const selectUser = `SELECT user_id FROM user WHERE username='${username}';`;

    const loggedInUser = await db.get(selectUser);

    const selectUserIdFromFollower = `SELECT * FROM follower
                        WHERE follower_user_id=${loggedInUser.user_id} AND
                        following_user_id IN (SELECT user_id FROM tweet WHERE tweet_id=${tweetId})`;

    const checkUserIdByFollowingId = await db.all(selectUserIdFromFollower);
    //  console.log(checkUserIdByFollowingId);
    if (checkUserIdByFollowingId === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const selectWhoLiked = `SELECT user.username, reply.reply 
                    FROM user INNER JOIN reply ON user.user_id=reply.user_id
                    WHERE user.user_id IN (SELECT user_id FROM reply 
                        WHERE tweet_id=${tweetId});`;

      const dbResponse = await db.all(selectWhoLiked);
      //console.log(dbResponse);
      let replies = [];

      dbResponse.forEach((each) => {
        let temp = { name: each.username, reply: each.reply };

        replies.push(temp);
      });
      response.send({ replies });
    }
  }
);

app.get("/user/tweets/", authenticateJwtToken, async (request, response) => {
  const { username } = request;
  const selectUser = `SELECT user_id FROM user WHERE username='${username}';`;

  const loggedInUser = await db.get(selectUser);

  const selectTweetsByUser = `SELECT tweet.tweet, (COUNT(like_id)) AS likes,
                (COUNT(reply_id)) AS replies, tweet.date_time AS dateTime
                FROM ((tweet INNER JOIN like ON tweet.tweet_id=like.tweet_id)
                INNER JOIN reply ON tweet.tweet_id=reply.tweet_id)
                    WHERE tweet.user_id=${loggedInUser.user_id};`;

  const dbResponse = await db.all(selectTweetsByUser);
  response.send(dbResponse);
});

app.post("/user/tweets/", authenticateJwtToken, async (request, response) => {
  const { tweet } = request.body;

  const createATweet = `INSERT INTO tweet(tweet)
                        VALUES('${tweet}');`;

  await db.run(createATweet);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateJwtToken,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const selectUser = `SELECT user_id FROM user WHERE username='${username}';`;

    const loggedInUser = await db.get(selectUser);

    const getUserIdByTweetId = `SELECT user_id FROM tweet 
                    WHERE tweet_id=${tweetId}`;

    const temUserId = await db.get(getUserIdByTweetId);
    //
    // console.log(temUserId);

    if (temUserId.user_id === loggedInUser.user_id) {
      const deleteTweet = `DELETE FROM tweet WHERE tweet_id=${tweetId};`;

      await db.run(deleteTweet);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;

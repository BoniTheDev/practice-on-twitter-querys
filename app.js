const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

//Password validation

const validatePasswords = (password) => {
  return password.length > 5;
};

// Create USER API
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  //console.log(hashedPassword);
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);

  if (dbUser === undefined) {
    const createUserQuery = `
                               INSERT INTO
                                   user(username,password,name,gender)
                                VALUES
                                 ('${username}','${hashedPassword}','${name}','${gender}');`;

    if (validatePasswords(password)) {
      await database.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// Login API

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// AuthToken

const AuthToken = (request, response, next) => {
  let jwtToken;
  const authHead = request.headers["authorization"];
  jwtToken = authHead.split(" ")[1];
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRET_KEY", (error, payload) => {
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

// Tweet Access Verification API

const tweetAccessVerification = async (request, response, next) => {
  const { username } = request;
  const getUserIdQuery = `SELECT 
                             user_id 
                          FROM
                             user 
                          WHERE 
                             username = '${username}';`;
  const userIdDb = await database.get(getUserIdQuery);

  const userId = userIdDb.user_id;
  const { tweetId } = request.params;
  const getTweetQuery = `SELECT
                           *
                         FROM tweet INNER JOIN follower
                         ON tweet.user_id = follower.following_user_id
                         WHERE tweet.tweet_id = '${tweetId}' AND follower_user_id = '${userId}';`;
  const tweet = await database.get(getTweetQuery);

  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

// API 3 Functions

const getFollowingPeopleIdsOfUser = async (username) => {
  const getUserFollowingPeopleArray = `SELECT
                                         following_user_id
                                       FROM follower INNER JOIN user
                                       ON user.user_id = follower.follower_user_id
                                       WHERE user.username='${username}';`;

  const getUserFollowingPeopleIdsArray = await database.all(
    getUserFollowingPeopleArray
  );
  //console.log(getUserFollowingPeopleIdsArray);
  const arrayOfIds = getUserFollowingPeopleIdsArray.map(
    (eachUser) => eachUser.following_user_id
  );
  return arrayOfIds;
};
//Get Tweets as per UserFollowing People API - 3

app.get("/user/tweets/feed/", AuthToken, async (request, response) => {
  let { username } = request;

  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);
  //console.log(followingPeopleIds);
  const getTweetsQuery = `SELECT
username,tweet, date_time as dateTime
FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
WHERE
user.user_id IN (${followingPeopleIds})
ORDER BY date_time DESC
LIMIT 4;
`;
  const userFollowingPeoplelatesttweets = await database.all(getTweetsQuery);
  response.send(userFollowingPeoplelatesttweets);
});

// User Following Peoples names - API - 4

app.get("/user/following/", AuthToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT 
                             user_id 
                          FROM
                             user 
                          WHERE 
                             username = '${username}';`;
  const userIdDb = await database.get(getUserIdQuery);
  const userId = userIdDb.user_id;
  const getFollowingUsersQuery = `SELECT 
                                   name
                                  FROM follower INNER JOIN user 
                                 ON user.user_id = follower.following_user_id
                                 WHERE follower_user_id = '${userId}';`;

  const followingPeople = await database.all(getFollowingUsersQuery);
  response.send(followingPeople);
});

// Get user Followers API - 5
app.get("/user/followers/", AuthToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT 
                             user_id 
                          FROM
                             user 
                          WHERE 
                             username = '${username}';`;
  const userIdDb = await database.get(getUserIdQuery);
  const userId = userIdDb.user_id;
  const getFollowersQuery = `SELECT name
                              FROM follower INNER JOIN user
                              ON user.user_id = follower.follower_user_id
                              WHERE following_user_id = ${userId};`;
  const getFollowers = await database.all(getFollowersQuery);
  response.send(getFollowers);
});

//User Request tweetsCount his following API - 6

app.get(
  "/tweets/:tweetId/",
  AuthToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;

    const getTweetQuery = `SELECT tweet,
(SELECT COUNT(*) FROM like WHERE tweet_id = '${tweetId}') AS likes,
(SELECT COUNT(*) FROM reply WHERE tweet_id = '${tweetId}') AS replies,
date_time AS dateTime
FROM tweet
WHERE tweet.tweet_id = '${tweetId}' ;`;
    const tweet = await database.get(getTweetQuery);
    response.send(tweet);
  }
);

// Request of people who liked tweet per tweetid API - 7

app.get(
  "/tweets/:tweetId/likes/",
  AuthToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikedPeopleQuery = `
                               SELECT 
                                  username
                               FROM user INNER JOIN like
                               ON user.user_id = like.user_id
                               WHERE  tweet_id = ${tweetId}`;
    const tweetlikedPeopleDb = await database.all(getLikedPeopleQuery);
    const likedPeopleArray = tweetlikedPeopleDb.map(
      (tweetLiked) => tweetLiked.username
    );
    response.send({ likes: likedPeopleArray });
  }
);

// Get tweet replies for an tweet id API - 8

app.get(
  "/tweets/:tweetId/replies/",
  AuthToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliedQuery = `SELECT name,reply
FROM user INNER JOIN reply ON user.user_id = reply.user_id
WHERE tweet_id = '${tweetId}';
`;
    const repliedUsers = await database.all(getRepliedQuery);
    response.send({ replies: repliedUsers });
  }
);

// Returns a list of all tweets of the user API - 9

app.get("/user/tweets/", AuthToken, async (request, response) => {
  const { username } = request;
  const getUserIdQuery = `SELECT 
                             user_id 
                          FROM
                             user 
                          WHERE 
                             username = '${username}';`;
  const userIdDb = await database.get(getUserIdQuery);

  const userId = userIdDb.user_id;

  const getTweetsQuery = `
SELECT tweet,
COUNT(DISTINCT like_id) AS likes,
COUNT(DISTINCT reply_id) AS replies,
date_time AS dateTime
FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
LEFT JOIN like ON tweet.tweet_id = like.tweet_id
WHERE tweet.user_id = ${userId}
GROUP BY tweet.tweet_id;`;
  const tweets = await database.all(getTweetsQuery);
  response.send(tweets);
});

//Create a tweet in the tweet table API -  10

app.post("/user/tweets/", AuthToken, async (request, response) => {
  const { tweet } = request.body;
  const { username } = request;
  const getUserIdQuery = `SELECT 
                             user_id 
                          FROM
                             user 
                          WHERE 
                             username = '${username}';`;
  const userIdDb = await database.get(getUserIdQuery);

  const userId = userIdDb.user_id;
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `INSERT INTO tweet(tweet,user_id,date_time)
VALUES('${tweet}','${userId}','${dateTime}')
`;
  await database.run(createTweetQuery);
  response.send("Created a Tweet");
});

// Delete own Tweet by tweetId API - 11

app.delete("/tweets/:tweetId/", AuthToken, async (request, response) => {
  const { tweetId } = request.params;
  const { username } = request;
  const getUserIdQuery = `SELECT 
                             user_id 
                          FROM
                             user 
                          WHERE 
                             username = '${username}';`;
  const userIdDb = await database.get(getUserIdQuery);

  const userId = userIdDb.user_id;

  const getTheTweetQuery = `SELECT * FROM tweet WHERE user_id = '${userId}' AND tweet_id = '${tweetId}';`;
  const tweet = await database.get(getTheTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id ='${tweetId}';`;
    await database.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;

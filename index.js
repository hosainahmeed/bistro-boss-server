const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient } = require("mongodb");
const port = process.env.PORT || 5000;
require("dotenv").config();

const uri = process.env.DB_URI;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
async function run() {
  try {
    await client.connect();
    const menuCollection = client.db("bistroDb").collection("menu");
    const reviewCollection = client.db("bistroDb").collection("review");

    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result)
    });
    app.get("/review", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result)
    });
  } finally {
    //   await client.close();
  }
}
run().catch(console.dir);

app.use(cors());
app.use(express.json());
app.get("/", (req, res) => {
  res.send("bisad");
});

app.listen(port, () => {
  console.log(`server is running on ${port}`);
});

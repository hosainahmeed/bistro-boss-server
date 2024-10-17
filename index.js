const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const app = express();
const port = process.env.PORT || 5000;
//middleware
app.use(cors());
app.use(express.json());

// JWT Verification Middleware

const verifyToken = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }

  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "Unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri =`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.hqozp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  // ssl: true,
});

// Improve database connection logging
client
  .connect()
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Failed to connect to MongoDB", err));

// Connect to the database
// Connect 
async function run() {
  try {
    await client.connect();
    const menuCollection = client.db("bistroDb").collection("menus");
    const reviewCollection = client.db("bistroDb").collection("review");
    const cartCollection = client.db("bistroDb").collection("carts");
    const usersCollection = client.db("bistroDb").collection("users");
    const paymentCollection = client.db("bistroDb").collection("payments");

    // JWT Token Generator
    app.post("/jwt", (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }
      next();
    };

    // Get menu items
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    // Add a menu item (Admin only)
    app.post("/menu", async (req, res) => {
      const result = await menuCollection.insertOne(item);
      const item = req.body;
      res.send(result);
    });

    // Delete a menu item (Admin only)
    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await menuCollection.deleteOne(query);
      res.send(result);
    });

    // Create a payment intent
    app.post("/create-checkout-session", verifyToken, async (req, res) => {
      const { price } = req.body;
      const amount = parseInt(price * 100);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // Add a user
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "User already exists!" });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Check if user is admin
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "Forbidden access" });
      }
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send(admin);
    });

    // Promote user to admin
    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: {
            role: "admin",
          },
        };
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      }
    );

    // Delete a user (Admin only)
    app.delete(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await usersCollection.deleteOne(query);
        res.send(result);
      }
    );

    // Get all users
    app.get("/users",  async (req, res) => {
      try {
        const result = await usersCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });

    // Add payment information
    app.post("/payments", async (req, res) => {
      try {
        const payment = req.body;

        // Check if `cartIds` is an array and contains valid data
        if (
          !payment.cartIds ||
          !Array.isArray(payment.cartIds) ||
          payment.cartIds.length === 0
        ) {
          return res.status(400).send({
            error: "Invalid cartIds: cartIds must be a non-empty array",
          });
        }

        // Insert the payment into the database
        const paymentResult = await paymentCollection.insertOne(payment);

        // Carefully delete each item from the cart
        const query = {
          _id: {
            $in: payment.cartIds.map((id) => new ObjectId(String(id))), // Ensure ids are valid ObjectId strings
          },
        };

        const deleteResult = await cartCollection.deleteMany(query);

        console.log("Payment endpoint hit successfully", {
          paymentResult,
          deleteResult,
        });

        // Send the result back to the client
        res.status(200).send({ paymentResult, deleteResult });
      } catch (error) {
        console.error("Error at payment endpoint:", error);

        // Handle any unexpected errors
        res
          .status(500)
          .send({ error: "An error occurred while processing the payment" });
      }
    });

    // Get carts by user email
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.send([]);
      }
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    // Get admin statistics
    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const users = await usersCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();
      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce(
        (total, payment) => total + payment.price,
        0
      );

      res.send({
        revenue,
        orders,
        users,
        products,
      });
    });

    // Get order statistics
    app.get("/order-stats", verifyToken, verifyAdmin, async (req, res) => {
      const result = await paymentCollection
        .aggregate([
          {
            $lookup: {
              from: "menu",
              localField: "menuItems",
              foreignField: "_id",
              as: "menuItems",
            },
          },
          {
            $unwind: "$menuItems",
          },
          {
            $group: {
              _id: "$menuItems.category",
              quantity: { $sum: 1 },
              revenue: { $sum: "$menuItems.price" },
            },
          },
          {
            $project: {
              _id: 0,
              category: "$_id",
              quantity: "$quantity",
              revenue: "$revenue",
            },
          },
        ])
        .toArray();

      res.send(result);
    });

    // Delete a cart item
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // Get all reviews
    app.get("/review", async (req, res) => {
      try {
        const result = await reviewCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch reviews" });
      }
    });

    // Add item to cart
    app.post("/carts", async (req, res) => {
      try {
        const item = req.body;
        const result = await cartCollection.insertOne(item);
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: "Failed to add item to cart" });
      }
    });
  } catch (error) {
    console.error("Error connecting to the database", error);
  } finally {
    // Keeping the connection open for the server lifecycle
  }
}

// Start the database connection and server
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

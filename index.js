const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const uri = process.env.DB_URI;
const port = process.env.PORT || 5000;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  ssl: true,
});

// Middleware for JWT verification
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

// Middleware to verify admin role
const verifyAdmin = async (req, res, next) => {
  const user = await client.db("bistroDb").collection("users").findOne({ email: req.decoded.email });
  if (!user || user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden access" });
  }
  next();
};

// Connect to the database and define API routes
async function run() {
  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("bistroDb");
    const menuCollection = db.collection("menu");
    const reviewCollection = db.collection("review");
    const cartCollection = db.collection("carts");
    const usersCollection = db.collection("users");
    const paymentCollection = db.collection("payments");

    // Generate JWT token
    app.post("/jwt", (req, res) => {
      const token = jwt.sign(req.body, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
      res.json({ token });
    });

    // Get menu items
    app.get("/menu", async (req, res) => {
      try {
        const menuItems = await menuCollection.find().toArray();
        res.json(menuItems);
      } catch (error) {
        console.error("Error fetching menu items:", error);
        res.status(500).json({ error: "Failed to fetch menu items" });
      }
    });

    // Add a menu item (Admin only)
    app.post("/menu", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await menuCollection.insertOne(req.body);
        res.json(result);
      } catch (error) {
        console.error("Error adding menu item:", error);
        res.status(500).json({ error: "Failed to add menu item" });
      }
    });

    // Delete a menu item (Admin only)
    app.delete("/menu/:id", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await menuCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.json(result);
      } catch (error) {
        console.error("Error deleting menu item:", error);
        res.status(500).json({ error: "Failed to delete menu item" });
      }
    });

    // Create a payment intent
    app.post("/create-checkout-session", verifyToken, async (req, res) => {
      const { price } = req.body;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(price * 100),
          currency: "usd",
          payment_method_types: ["card"],
        });
        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.error("Error creating payment intent:", error);
        res.status(500).json({ error: "Failed to create payment intent" });
      }
    });

    // User registration
    app.post("/users", async (req, res) => {
      const user = req.body;
      try {
        const existingUser = await usersCollection.findOne({ email: user.email });
        if (existingUser) {
          return res.status(400).json({ message: "User already exists!" });
        }
        const result = await usersCollection.insertOne(user);
        res.json(result);
      } catch (error) {
        console.error("Error adding user:", error);
        res.status(500).json({ error: "Failed to add user" });
      }
    });

    // Check if user is admin
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).json({ message: "Forbidden access" });
      }

      const user = await usersCollection.findOne({ email });
      res.json({ admin: user?.role === "admin" });
    });

    // Promote user to admin
    app.patch("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role: "admin" } }
      );
      res.json(result);
    });

    // Delete a user (Admin only)
    app.delete("/users/admin/:id", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.json(result);
    });

    // Get all users
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection.find().toArray();
        res.json(users);
      } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ error: "Failed to fetch users" });
      }
    });

    // Add payment information
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      if (!Array.isArray(payment.cartIds) || payment.cartIds.length === 0) {
        return res.status(400).json({ error: "Invalid cartIds: must be a non-empty array" });
      }

      try {
        const paymentResult = await paymentCollection.insertOne(payment);
        const deleteResult = await cartCollection.deleteMany({
          _id: { $in: payment.cartIds.map((id) => new ObjectId(id)) },
        });
        res.status(200).json({ paymentResult, deleteResult });
      } catch (error) {
        console.error("Error processing payment:", error);
        res.status(500).json({ error: "Failed to process payment" });
      }
    });

    // Get carts by user email
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.json([]);
      }
      const carts = await cartCollection.find({ email }).toArray();
      res.json(carts);
    });

    // Get admin statistics
    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const [users, products, orders] = await Promise.all([
        usersCollection.estimatedDocumentCount(),
        menuCollection.estimatedDocumentCount(),
        paymentCollection.estimatedDocumentCount(),
      ]);

      const payments = await paymentCollection.find().toArray();
      const revenue = payments.reduce((total, payment) => total + payment.price, 0);

      res.json({ revenue, orders, users, products });
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
          { $unwind: "$menuItems" },
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
      res.json(result);
    });

    // Delete a cart item
    app.delete("/carts/:id", async (req, res) => {
      try {
        const result = await cartCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.json(result);
      } catch (error) {
        console.error("Error deleting cart item:", error);
        res.status(500).json({ error: "Failed to delete cart item" });
      }
    });

    // Get all reviews
    app.get("/review", async (req, res) => {
      try {
        const reviews = await reviewCollection.find().toArray();
        res.json(reviews);
      } catch (error) {
        console.error("Error fetching reviews:", error);
        res.status(500).json({ error: "Failed to fetch reviews" });
      }
    });

    // Add a review
    app.post("/review", async (req, res) => {
      try {
        const result = await reviewCollection.insertOne(req.body);
        res.json(result);
      } catch (error) {
        console.error("Error adding review:", error);
        res.status(500).json({ error: "Failed to add review" });
      }
    });

  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
  }
}

// Start the server and database connection
app.listen(port, () => {
  run().catch(console.error);
  console.log(`Server is running on port ${port}`);
});

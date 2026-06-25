const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const express = require("express");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const uri = process.env.MONGODB_URI;
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db("skillswap");

    // Assignment Requirement Collections
    const usersCollection = db.collection("users");
    const tasksCollection = db.collection("tasks");
    const proposalsCollection = db.collection("proposals");
    const paymentsCollection = db.collection("payments");
    const reviewsCollection = db.collection("reviews");

    // ==========================================
    // BROWSE TASKS (ALL LISTINGS WITH SEARCH + FILTER - NO PAGINATION)
    // ==========================================
    app.get("/tasks", async (req, res) => {
      try {
        const search = req.query.search || "";
        const category = req.query.category || "";

        let query = { status: "open" };

        if (search) {
          query.title = { $regex: search, $options: "i" };
        }
        if (category && category !== "All") {
          query.category = category;
        }

        // Fetches all matching documents directly without skipping or limiting
        const tasks = await tasksCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.json({ tasks });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch task catalog listings." });
      }
    });

    // ==========================================
    // CLIENT DASHBOARD ENDPOINTS (VERIFICATION REMOVED)
    // ==========================================

    // Client Stat Aggregation using an email query parameter for testing
    app.get("/client/stats", async (req, res) => {
      const email = req.query.email; // Pass via /client/stats?email=admin1@taskhive.com
      if (!email) {
        return res
          .status(400)
          .json({ message: "Missing email query parameter" });
      }

      try {
        const taskMetrics = await tasksCollection
          .aggregate([
            { $match: { client_email: email } },
            {
              $group: {
                _id: null,
                totalTasks: { $sum: 1 },
                openTasks: {
                  $sum: { $cond: [{ $eq: ["$status", "open"] }, 1, 0] },
                },
                tasksInProgress: {
                  $sum: { $cond: [{ $eq: ["$status", "In Progress"] }, 1, 0] },
                },
              },
            },
          ])
          .toArray();

        const financialMetrics = await paymentsCollection
          .aggregate([
            { $match: { client_email: email, payment_status: "successful" } },
            { $group: { _id: null, totalSpent: { $sum: "$amount" } } },
          ])
          .toArray();

        const stats = taskMetrics[0] || {
          totalTasks: 0,
          openTasks: 0,
          tasksInProgress: 0,
        };
        const totalSpent = financialMetrics[0]?.totalSpent || 0;

        res.json({
          totalTasks: stats.totalTasks,
          openTasks: stats.openTasks,
          tasksInProgress: stats.tasksInProgress,
          totalSpent: totalSpent,
        });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to compile dashboard tracking values." });
      }
    });

    // Post a New Task Form Route
    app.post("/tasks", async (req, res) => {
      try {
        const { title, category, description, budget, deadline, client_email } =
          req.body;

        const newTask = {
          title,
          category,
          description,
          budget: Number(budget), // Saved as a Number
          deadline,
          client_email, // Received straight from client form request state body
          status: "open",
          deliverable_url: null,
          createdAt: new Date(),
        };

        const result = await tasksCollection.insertOne(newTask);
        res.status(201).json(result);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to publish micro-task block structure." });
      }
    });

    app.get("/client/tasks", async (req, res) => {
      try {
        const email = req.query.email;

        // Guard rail clause if the frontend hits this endpoint without passing the session context
        if (!email) {
          return res
            .status(400)
            .json({ message: "Missing email query parameter" });
        }

        // Filter strictly by the creator's email address
        const query = { client_email: email };

        const myTasks = await tasksCollection
          .find(query)
          .sort({ createdAt: -1 }) // Keep newest items on top
          .toArray();

        res.json({ tasks: myTasks });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch your personal task entries." });
      }
    });

    // Edit Task
    app.patch("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updatedFields = req.body;

        const targetTask = await tasksCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!targetTask || targetTask.status !== "open") {
          return res.status(400).json({
            message: "Modifying tasks is restricted to 'open' states.",
          });
        }

        const result = await tasksCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updatedFields,
              budget: updatedFields.budget
                ? Number(updatedFields.budget)
                : undefined,
            },
          },
        );
        res.json(result);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to edit specified task node." });
      }
    });

    // Delete Task
    app.delete("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const task = await tasksCollection.findOne({ _id: new ObjectId(id) });

        if (!task || task.status !== "open") {
          return res.status(400).json({
            message: "In-progress or completed tasks cannot be dropped.",
          });
        }

        const result = await tasksCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json(result);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to discard the specified task record." });
      }
    });

    // ==========================================
    // FREELANCER DASHBOARD ENDPOINTS (VERIFICATION REMOVED)
    // ==========================================

    // Submit a New Bid/Proposal Application Route
    app.post("/proposals", async (req, res) => {
      try {
        const {
          task_id,
          proposed_budget,
          estimated_days,
          cover_note,
          freelancer_email,
        } = req.body;

        const existingProposal = await proposalsCollection.findOne({
          task_id,
          freelancer_email,
        });

        if (existingProposal) {
          return res.status(400).json({
            message: "You have already submitted a proposal for this task.",
          });
        }

        const newProposal = {
          task_id,
          freelancer_email,
          proposed_budget: Number(proposed_budget),
          estimated_days: parseInt(estimated_days),
          cover_note,
          status: "pending",
          submitted_at: new Date(),
        };

        const result = await proposalsCollection.insertOne(newProposal);
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({
          message: "Failed to commit your bidding proposal application.",
        });
      }
    });

    // Fetch Freelancer Submissions via query string parameter
    app.get("/proposals/mine", async (req, res) => {
      try {
        const email = req.query.email;
        const result = await proposalsCollection
          .find({ freelancer_email: email })
          .toArray();
        res.json(result);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch active proposal lines." });
      }
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } catch (error) {
    console.error("Database boot failure loop:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("SkillSwap Unprotected Development Server Running.");
});

app.listen(PORT, () => {
  console.log(`Server executing successfully on Port ${PORT}`);
});

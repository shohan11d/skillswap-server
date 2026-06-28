const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const express = require("express");
const dotenv = require("dotenv");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
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

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log("payload", payload);
    next();
  } catch (error) {
    return res.status(403).json({ message: "Forbidden" });
  }
};

async function run() {
  try {
    const db = client.db("skillswap");
    const usersCollection = db.collection("user");
    const tasksCollection = db.collection("tasks");
    const proposalsCollection = db.collection("proposals");
    const paymentsCollection = db.collection("payments");
    const reviewsCollection = db.collection("reviews");

    // ==========================================
    // HEALTH CHECK
    // ==========================================
    app.get("/", (req, res) => {
      res.send("SkillSwap Development Server Running.");
    });

    // ==========================================
    // USER ENDPOINTS
    // ==========================================

    // Save user to DB on registration (call this from your frontend after BetterAuth signup)
    app.post("/users", async (req, res) => {
      try {
        const { name, email, image, role } = req.body;
        if (!email) {
          return res.status(400).json({ message: "Email is required." });
        }
        // Upsert: insert if not exists, skip if already saved
        const existing = await usersCollection.findOne({ email });
        if (existing) {
          return res
            .status(200)
            .json({ message: "User already exists.", user: existing });
        }
        const newUser = {
          name: name || "",
          email,
          image: image || "",
          role: role || "client", // "client" | "freelancer" | "admin"
          skills: [],
          bio: "",
          hourlyRate: 0,
          isBlocked: false,
          createdAt: new Date(),
        };
        const result = await usersCollection.insertOne(newUser);
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to save user record." });
      }
    });

    // Get a single user by email (used for profile pages and role checks)
    app.get("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found." });
        }
        res.json(user);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch user profile." });
      }
    });

    // Update freelancer profile (name, image, skills, bio, hourlyRate)
    app.patch("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const { name, image, skills, bio, hourlyRate } = req.body;
        const updateFields = {};
        if (name !== undefined) updateFields.name = name;
        if (image !== undefined) updateFields.image = image;
        if (skills !== undefined) updateFields.skills = skills;
        if (bio !== undefined) updateFields.bio = bio;
        if (hourlyRate !== undefined)
          updateFields.hourlyRate = Number(hourlyRate);

        const result = await usersCollection.updateOne(
          { email },
          { $set: updateFields },
        );
        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found." });
        }
        res.json({ message: "Profile updated successfully.", result });
      } catch (error) {
        res.status(500).json({ message: "Failed to update user profile." });
      }
    });

    // Browse Freelancers page — all users with role "freelancer"
    // Browse Freelancers page — all users with role "freelancer"
    app.get("/freelancers", async (req, res) => {
      try {
        const freelancers = await usersCollection
          .find({ role: "freelancer" })
          .sort({ createdAt: -1 })
          .toArray();

        const enriched = await Promise.all(
          freelancers.map(async (f) => {
            const reviews = await reviewsCollection
              .find({ reviewee_email: f.email })
              .toArray();
            const completedJobs = await tasksCollection.countDocuments({
              freelancer_email: f.email,
              status: "completed",
            });
            const avgRating =
              reviews.length > 0
                ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
                : 0;
            return {
              ...f,
              averageRating: parseFloat(avgRating.toFixed(1)),
              completedJobs,
              totalReviews: reviews.length,
            };
          }),
        );

        res.json({ freelancers: enriched });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch freelancer listings." });
      }
    });

    // ==========================================
    // TASKS — PUBLIC
    // ==========================================

    // Home page: latest 6 open tasks for the Featured Tasks section
    app.get("/tasks/featured", async (req, res) => {
      try {
        const tasks = await tasksCollection
          .find({ status: "open" })
          .sort({ createdAt: -1 })
          .limit(6)
          .toArray();
        res.json({ tasks });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch featured tasks." });
      }
    });

    // ============ Frreelancer get tasks ============
    // Browse Tasks: search + category filter, returns all matches (pagination added later)
    app.get("/tasks", async (req, res) => {
      try {
        const search = req.query.search || "";
        const category = req.query.category || "";
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 9);
        const skip = (page - 1) * limit;

        const query = { status: "open" };
        if (search) query.title = { $regex: search, $options: "i" };
        if (category && category !== "All") query.category = category;

        const [tasks, total] = await Promise.all([
          tasksCollection
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
          tasksCollection.countDocuments(query),
        ]);

        res.json({ tasks, total, page, limit });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch task catalog listings." });
      }
    });

    // Single task detail (used on Task Details page and proposal form)
    // NOTE: This must be defined AFTER /tasks/featured to avoid "featured" being
    // treated as a MongoDB ObjectId
    //
    app.get("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid task ID format." });
        }
        const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
        if (!task) {
          return res.status(404).json({ message: "Task not found." });
        }
        // Also send the client's name by joining with users
        const clientUser = await usersCollection.findOne({
          email: task.client_email,
        });
        res.json({
          ...task,
          client_name: clientUser?.name || task.client_email,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch task details." });
      }
    });

    // ==========================================
    // CLIENT DASHBOARD
    // ==========================================

    app.get("/client/stats", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res
          .status(400)
          .json({ message: "Missing email query parameter." });
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
                  $sum: { $cond: [{ $eq: ["$status", "in_progress"] }, 1, 0] },
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
        res.json({
          totalTasks: stats.totalTasks,
          openTasks: stats.openTasks,
          tasksInProgress: stats.tasksInProgress,
          totalSpent: financialMetrics[0]?.totalSpent || 0,
        });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to compile client dashboard stats." });
      }
    });

    // Post a new task
    app.post("/tasks", verifyToken, async (req, res) => {
      try {
        const { title, category, description, budget, deadline, client_email } =
          req.body;
        if (
          !title ||
          !category ||
          !description ||
          !budget ||
          !deadline ||
          !client_email
        ) {
          return res
            .status(400)
            .json({ message: "All task fields are required." });
        }
        const newTask = {
          title,
          category,
          description,
          budget: Number(budget),
          deadline,
          client_email,
          status: "open",
          deliverable_url: null,
          createdAt: new Date(),
        };
        const result = await tasksCollection.insertOne(newTask);
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to publish task." });
      }
    });

    // ============  Client TAsks fetch ============
    app.get("/client/tasks", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res
            .status(400)
            .json({ message: "Missing email query parameter." });
        }
        const myTasks = await tasksCollection
          .find({ client_email: email })
          .sort({ createdAt: -1 })
          .toArray();
        res.json({ tasks: myTasks });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch your task entries." });
      }
    });

    // Edit a task (only if status is "open")
    app.patch("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid task ID format." });
        }
        const updatedFields = req.body;
        const targetTask = await tasksCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!targetTask) {
          return res.status(404).json({ message: "Task not found." });
        }
        if (targetTask.status !== "open") {
          return res
            .status(400)
            .json({ message: "Only open tasks can be edited." });
        }
        const setFields = { ...updatedFields };
        if (setFields.budget) setFields.budget = Number(setFields.budget);
        // Don't allow status to be changed through this route
        delete setFields._id;
        const result = await tasksCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: setFields },
        );
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to update task." });
      }
    });

    // Delete a task (only if no proposal has been accepted yet)
    app.delete("/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid task ID format." });
        }
        const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
        if (!task) {
          return res.status(404).json({ message: "Task not found." });
        }
        if (task.status !== "open") {
          return res.status(400).json({
            message: "In-progress or completed tasks cannot be deleted.",
          });
        }
        const acceptedProposal = await proposalsCollection.findOne({
          task_id: id,
          status: "accepted",
        });
        if (acceptedProposal) {
          return res.status(400).json({
            message: "Cannot delete a task with an accepted proposal.",
          });
        }
        const result = await tasksCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to delete task." });
      }
    });

    // ==========================================
    // PROPOSALS
    // ==========================================

    // Get all proposals for a specific task (used in client's Manage Proposals view)
    app.get("/proposals/task/:taskId", async (req, res) => {
      try {
        const { taskId } = req.params;
        const proposals = await proposalsCollection
          .find({ task_id: taskId })
          .sort({ submitted_at: -1 })
          .toArray();

        // Enrich with freelancer name from users collection
        const enriched = await Promise.all(
          proposals.map(async (p) => {
            const user = await usersCollection.findOne({
              email: p.freelancer_email,
            });
            return { ...p, freelancer_name: user?.name || p.freelancer_email };
          }),
        );
        res.json({ proposals: enriched });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch proposals for this task." });
      }
    });

    // Submit a new proposal (freelancer applies to a task)
    // ======== Freelancer proposal submit =====
    app.post("/proposals", verifyToken, async (req, res) => {
      try {
        const {
          task_id,
          proposed_budget,
          estimated_days,
          cover_note,
          freelancer_email,
        } = req.body;
        if (
          !task_id ||
          !proposed_budget ||
          !estimated_days ||
          !cover_note ||
          !freelancer_email
        ) {
          return res
            .status(400)
            .json({ message: "All proposal fields are required." });
        }
        // Block duplicate applications
        const existing = await proposalsCollection.findOne({
          task_id,
          freelancer_email,
        });
        if (existing) {
          return res.status(400).json({
            message: "You already submitted a proposal for this task.",
          });
        }
        // Block applying to your own task (if the freelancer is also a client)
        const task = await tasksCollection.findOne({
          _id: new ObjectId(task_id),
        });
        if (task && task.client_email === freelancer_email) {
          return res
            .status(400)
            .json({ message: "You cannot apply to your own task." });
        }
        const newProposal = {
          task_id,
          freelancer_email,
          proposed_budget: Number(proposed_budget),
          estimated_days: parseInt(estimated_days),
          cover_note,
          status: "pending",
          submitted_at: new Date(),
          client_email: task?.client_email,
        };
        const result = await proposalsCollection.insertOne(newProposal);
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to submit proposal." });
      }
    });

    // Accept or reject a proposal
    // Accepting also updates the task status to "in_progress" and saves the freelancer's email on the task
    app.patch("/proposals/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { status } = req.body; // "accepted" or "rejected"
        if (!["accepted", "rejected"].includes(status)) {
          return res
            .status(400)
            .json({ message: "Status must be 'accepted' or 'rejected'." });
        }
        if (!ObjectId.isValid(id)) {
          return res
            .status(400)
            .json({ message: "Invalid proposal ID format." });
        }
        const proposal = await proposalsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!proposal) {
          return res.status(404).json({ message: "Proposal not found." });
        }

        // If accepting, make sure no other proposal is already accepted for this task
        if (status === "accepted") {
          const alreadyAccepted = await proposalsCollection.findOne({
            task_id: proposal.task_id,
            status: "accepted",
          });
          if (alreadyAccepted) {
            return res.status(400).json({
              message: "A proposal for this task has already been accepted.",
            });
          }
          // Update the task: set status to in_progress and record the hired freelancer
          await tasksCollection.updateOne(
            { _id: new ObjectId(proposal.task_id) },
            {
              $set: {
                status: "in_progress",
                freelancer_email: proposal.freelancer_email,
                accepted_budget: proposal.proposed_budget,
              },
            },
          );
        }

        const result = await proposalsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } },
        );
        res.json({ message: `Proposal ${status} successfully.`, result });
      } catch (error) {
        res.status(500).json({ message: "Failed to update proposal status." });
      }
    });

    // Get all proposals for a client (using client_email stored on proposal)
    app.get("/proposals/client", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res
            .status(400)
            .json({ message: "Missing email query parameter." });
        }
        const proposals = await proposalsCollection
          .find({ client_email: email })
          .sort({ submitted_at: -1 })
          .toArray();

        // Enrich with freelancer name and task title
        const enriched = await Promise.all(
          proposals.map(async (p) => {
            const freelancer = await usersCollection.findOne({
              email: p.freelancer_email,
            });
            let taskTitle = "Unknown Task";
            if (ObjectId.isValid(p.task_id)) {
              const task = await tasksCollection.findOne({
                _id: new ObjectId(p.task_id),
              });
              taskTitle = task?.title || taskTitle;
            }
            return {
              ...p,
              freelancer_name: freelancer?.name || p.freelancer_email,
              task_title: taskTitle,
            };
          }),
        );
        res.json({ proposals: enriched });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch client proposals." });
      }
    });

    // edit profile
    app.patch("/users/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const { name, image, bio, hourlyRate, skills } = req.body;

        // 1. Find the user to verify role permissions
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // 2. Strict Role Check: Block clients from accessing freelancer-only fields
        if (user.role !== "freelancer") {
          return res.status(403).json({
            message: "Forbidden: Only freelancers can update profile details.",
          });
        }

        // 3. Update using $set to append new structural fields dynamically
        const updateDoc = {
          $set: {
            name,
            image,
            bio,
            hourlyRate: Number(hourlyRate),
            skills: Array.isArray(skills) ? skills : [],
            updatedAt: new Date(), // Syncs with BetterAuth's tracking format
          },
        };

        const result = await usersCollection.updateOne({ email }, updateDoc);

        if (result.matchedCount === 0) {
          return res
            .status(404)
            .json({ message: "Failed to update database record." });
        }

        res.status(200).json({ message: "Profile updated successfully!" });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Internal server error", error: error.message });
      }
    });

    // Freelancer's own submitted proposals
    app.get("/proposals/mine", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res
            .status(400)
            .json({ message: "Missing email query parameter." });
        }
        const proposals = await proposalsCollection
          .find({ freelancer_email: email })
          .sort({ submitted_at: -1 })
          .toArray();

        // Enrich with task titles
        const enriched = await Promise.all(
          proposals.map(async (p) => {
            let taskTitle = "Unknown Task";
            if (ObjectId.isValid(p.task_id)) {
              const task = await tasksCollection.findOne({
                _id: new ObjectId(p.task_id),
              });
              taskTitle = task?.title || taskTitle;
            }
            return { ...p, task_title: taskTitle };
          }),
        );
        res.json({ proposals: enriched });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch your proposals." });
      }
    });

    // ==========================================
    // FREELANCER DASHBOARD
    // ==========================================

    app.get("/freelancer/stats", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res
            .status(400)
            .json({ message: "Missing email query parameter." });
        }
        const proposalMetrics = await proposalsCollection
          .aggregate([
            { $match: { freelancer_email: email } },
            {
              $group: {
                _id: null,
                totalProposals: { $sum: 1 },
                pendingProposals: {
                  $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
                },
                acceptedProposals: {
                  $sum: { $cond: [{ $eq: ["$status", "accepted"] }, 1, 0] },
                },
              },
            },
          ])
          .toArray();
        const earningsMetrics = await paymentsCollection
          .aggregate([
            {
              $match: { freelancer_email: email, payment_status: "successful" },
            },
            { $group: { _id: null, totalEarnings: { $sum: "$amount" } } },
          ])
          .toArray();
        const stats = proposalMetrics[0] || {
          totalProposals: 0,
          pendingProposals: 0,
          acceptedProposals: 0,
        };
        res.json({
          totalProposals: stats.totalProposals,
          pendingProposals: stats.pendingProposals,
          acceptedProposals: stats.acceptedProposals,
          totalEarnings: earningsMetrics[0]?.totalEarnings || 0,
        });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to compile freelancer dashboard stats." });
      }
    });

    // Active projects: tasks where this freelancer was hired and work is in progress
    app.get("/freelancer/active-projects", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res
            .status(400)
            .json({ message: "Missing email query parameter." });
        }
        const projects = await tasksCollection
          .find({
            freelancer_email: email,
            status: { $in: ["in_progress", "completed"] },
          })
          .sort({ createdAt: -1 })
          .toArray();
        res.json({ projects });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch active projects." });
      }
    });

    // ====== Admin ====
    // 1. Get all users for administration
    app.get("/admin/users", async (req, res) => {
      try {
        // Exclude passwords or sensitive internal tokens if any exist
        const users = await usersCollection
          .find({}, { projection: { password: 0 } })
          .toArray();
        res.json({ users });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch platform accounts." });
      }
    });

    // 2. Block a user
    app.patch("/admin/users/:id/block", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isBlocked: true } },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User account not found." });
        }
        res.json({
          success: true,
          message: "User has been blocked successfully.",
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to update block state." });
      }
    });

    // 3. Unblock a user
    app.patch("/admin/users/:id/unblock", async (req, res) => {
      try {
        const { id } = req.params;
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isBlocked: false } },
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User account not found." });
        }
        res.json({
          success: true,
          message: "User has been unblocked successfully.",
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to update unblock state." });
      }
    });

    // Submit deliverable: freelancer marks a task as completed and provides a link
    app.patch("/tasks/:id/deliver", async (req, res) => {
      try {
        const { id } = req.params;
        const { deliverable_url, freelancer_email } = req.body;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid task ID format." });
        }
        if (!deliverable_url) {
          return res
            .status(400)
            .json({ message: "Deliverable URL is required." });
        }
        const task = await tasksCollection.findOne({ _id: new ObjectId(id) });
        if (!task) {
          return res.status(404).json({ message: "Task not found." });
        }
        if (task.freelancer_email !== freelancer_email) {
          return res.status(403).json({
            message: "You are not the assigned freelancer for this task.",
          });
        }
        if (task.status !== "in_progress") {
          return res.status(400).json({
            message: "Only in-progress tasks can be marked as completed.",
          });
        }
        const result = await tasksCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              status: "completed",
              deliverable_url,
              completedAt: new Date(),
            },
          },
        );
        res.json({
          message: "Deliverable submitted. Task marked as completed.",
          result,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to submit deliverable." });
      }
    });

    // Freelancer earnings history
    app.get("/freelancer/earnings", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email) {
          return res
            .status(400)
            .json({ message: "Missing email query parameter." });
        }
        const payments = await paymentsCollection
          .find({ freelancer_email: email, payment_status: "successful" })
          .sort({ paid_at: -1 })
          .toArray();

        // Enrich with task title and client name
        const enriched = await Promise.all(
          payments.map(async (p) => {
            let taskTitle = "Unknown Task";
            let clientName = p.client_email;
            if (p.task_id && ObjectId.isValid(p.task_id)) {
              const task = await tasksCollection.findOne({
                _id: new ObjectId(p.task_id),
              });
              taskTitle = task?.title || taskTitle;
            }
            const clientUser = await usersCollection.findOne({
              email: p.client_email,
            });
            clientName = clientUser?.name || clientName;
            return { ...p, task_title: taskTitle, client_name: clientName };
          }),
        );
        res.json({ earnings: enriched });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch earnings history." });
      }
    });

    // ==========================================
    // ADMIN DASHBOARD
    // ==========================================

    app.get("/admin/stats", async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalTasks = await tasksCollection.countDocuments();
        const activeTasks = await tasksCollection.countDocuments({
          status: "in_progress",
        });
        const revenueData = await paymentsCollection
          .aggregate([
            { $match: { payment_status: "successful" } },
            { $group: { _id: null, totalRevenue: { $sum: "$amount" } } },
          ])
          .toArray();
        res.json({
          totalUsers,
          totalTasks,
          activeTasks,
          totalRevenue: revenueData[0]?.totalRevenue || 0,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch admin statistics." });
      }
    });

    // List all users (admin)
    app.get("/admin/users", async (req, res) => {
      try {
        const users = await usersCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        res.json({ users });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch user list." });
      }
    });

    // Block or unblock a user
    app.patch("/admin/users/:id/block", async (req, res) => {
      try {
        const { id } = req.params;
        const { isBlocked } = req.body;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid user ID format." });
        }
        if (typeof isBlocked !== "boolean") {
          return res
            .status(400)
            .json({ message: "isBlocked must be a boolean value." });
        }
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { isBlocked } },
        );
        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found." });
        }
        res.json({
          message: `User ${isBlocked ? "blocked" : "unblocked"} successfully.`,
          result,
        });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to update user block status." });
      }
    });

    // List all tasks (admin)
    app.get("/admin/tasks", async (req, res) => {
      try {
        const tasks = await tasksCollection
          .find({})
          .sort({ createdAt: -1 })
          .toArray();
        res.json({ tasks });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch task list." });
      }
    });

    // Delete any task (admin — no status restriction)
    app.delete("/admin/tasks/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid task ID format." });
        }
        const result = await tasksCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Task not found." });
        }
        res.json({ message: "Task deleted successfully.", result });
      } catch (error) {
        res.status(500).json({ message: "Failed to delete task." });
      }
    });

    // Transactions history (admin)
    app.get("/admin/transactions", async (req, res) => {
      try {
        const transactions = await paymentsCollection
          .find({})
          .sort({ paid_at: -1 })
          .toArray();
        res.json({ transactions });
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch transaction history." });
      }
    });

    // ==========================================
    // REVIEWS
    // ==========================================

    // Post a review (client reviews freelancer after task completion)
    app.post("/reviews", async (req, res) => {
      try {
        const { task_id, reviewer_email, reviewee_email, rating, comment } =
          req.body;
        if (!task_id || !reviewer_email || !reviewee_email || !rating) {
          return res
            .status(400)
            .json({ message: "All review fields are required." });
        }
        // One review per task
        const existing = await reviewsCollection.findOne({
          task_id,
          reviewer_email,
        });
        if (existing) {
          return res.status(400).json({
            message: "You have already submitted a review for this task.",
          });
        }
        const newReview = {
          task_id,
          reviewer_email,
          reviewee_email,
          rating: Number(rating),
          comment: comment || "",
          created_at: new Date(),
        };
        const result = await reviewsCollection.insertOne(newReview);
        res.status(201).json(result);
      } catch (error) {
        res.status(500).json({ message: "Failed to submit review." });
      }
    });

    // Get all reviews for a freelancer (shown on their public profile)
    app.get("/reviews/:email", async (req, res) => {
      try {
        const { email } = req.params;
        const reviews = await reviewsCollection
          .find({ reviewee_email: email })
          .sort({ created_at: -1 })
          .toArray();
        const avgRating =
          reviews.length > 0
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
            : 0;
        res.json({
          reviews,
          averageRating: parseFloat(avgRating.toFixed(1)),
          totalReviews: reviews.length,
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch reviews." });
      }
    });

    app.get("/freelancers/:id", async (req, res) => {
      try {
        const { id } = req.params;
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid ID format." });
        }
        const freelancer = await usersCollection.findOne({
          _id: new ObjectId(id),
          role: "freelancer",
        });
        if (!freelancer) {
          return res.status(404).json({ message: "Freelancer not found." });
        }
        res.json(freelancer);
      } catch (error) {
        res
          .status(500)
          .json({ message: "Failed to fetch freelancer profile." });
      }
    });

    console.log("Connected to MongoDB successfully.");
  } catch (error) {
    console.error("Database connection failure:", error);
  }
}

run().catch(console.dir);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

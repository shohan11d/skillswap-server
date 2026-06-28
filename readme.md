s# SkillSwap — Backend API

Express + MongoDB REST API for the SkillSwap freelance micro-task platform.

---

## Tech Stack

- **Runtime** — Node.js
- **Framework** — Express.js
- **Database** — MongoDB (via official Node.js driver)
- **Auth** — BetterAuth JWT verification via JWKS
- **Environment** — dotenv

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB Atlas cluster (or local instance)
- A running SkillSwap frontend (for JWKS endpoint)

### Installation

```bash
git clone <your-repo-url>
cd server
npm install
```

### Environment Variables

Create a `.env` file in the root:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/skillswap
PORT=5000
CLIENT_URL=http://localhost:3000
```

### Run

```bash
# Development
node index.js

# Or with nodemon
npx nodemon index.js
```

Server runs on https://skillswap-server-nuad49gv2-mohammad-shohans-projects.vercel.app/by default.

---

## Database Collections

| Collection  | Description                          |
|-------------|--------------------------------------|
| `user`      | All registered users (BetterAuth)    |
| `tasks`     | Tasks posted by clients              |
| `proposals` | Freelancer proposals on tasks        |
| `payments`  | Payment records on proposal accept   |
| `reviews`   | Client reviews for freelancers       |

---

## Authentication

Protected routes use `verifyToken` middleware. Pass a Bearer token in the `Authorization` header:

```
Authorization: Bearer <jwt_token>
```

Tokens are verified against the BetterAuth JWKS endpoint at `CLIENT_URL/api/auth/jwks`.

---

## API Reference

### Health

| Method | Endpoint | Description       |
|--------|----------|-------------------|
| GET    | `/`      | Health check      |

---

### Users

| Method | Endpoint          | Auth | Description                        |
|--------|-------------------|------|------------------------------------|
| POST   | `/users`          | No   | Register / upsert user on signup   |
| GET    | `/users/:email`   | No   | Get user profile by email          |
| PATCH  | `/users/:email`   | No   | Update freelancer profile fields   |

**POST `/users` body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "image": "",
  "role": "client"
}
```

---

### Tasks

| Method | Endpoint              | Auth | Description                            |
|--------|-----------------------|------|----------------------------------------|
| GET    | `/tasks/featured`     | No   | Latest 6 open tasks for home page      |
| GET    | `/tasks`              | No   | Browse tasks with search/filter/pagination |
| GET    | `/tasks/:id`          | No   | Single task detail                     |
| POST   | `/tasks`              | Yes  | Post a new task (client)               |
| PATCH  | `/tasks/:id`          | No   | Edit task (open tasks only)            |
| DELETE | `/tasks/:id`          | No   | Delete task (open, no accepted proposal) |
| PATCH  | `/tasks/:id/deliver`  | No   | Submit deliverable (freelancer)        |

**GET `/tasks` query params:**

| Param      | Type   | Default | Description                  |
|------------|--------|---------|------------------------------|
| `search`   | string | `""`    | Filter by title (regex)      |
| `category` | string | `""`    | Filter by category           |
| `page`     | number | `1`     | Page number                  |
| `limit`    | number | `9`     | Results per page (max 50)    |

---

### Proposals

| Method | Endpoint                    | Auth | Description                             |
|--------|-----------------------------|------|-----------------------------------------|
| GET    | `/proposals/task/:taskId`   | No   | All proposals for a task                |
| GET    | `/proposals/client`         | No   | All proposals received by a client      |
| GET    | `/proposals/mine`           | No   | Freelancer's own submitted proposals    |
| POST   | `/proposals`                | Yes  | Submit a proposal                       |
| PATCH  | `/proposals/:id`            | Yes  | Accept or reject a proposal             |

**PATCH `/proposals/:id` body:**
```json
{ "status": "accepted" }
```
Accepts `"accepted"` or `"rejected"`. Accepting also sets the task to `in_progress` and records the freelancer on the task.

---

### Payments

| Method | Endpoint              | Auth | Description                        |
|--------|-----------------------|------|------------------------------------|
| POST   | `/payments`           | No   | Record a payment on proposal accept |
| GET    | `/payments/client`    | No   | Client payment history             |

**POST `/payments` body:**
```json
{
  "task_id": "abc123",
  "proposal_id": "def456",
  "client_email": "client@example.com",
  "freelancer_email": "freelancer@example.com",
  "amount": 250
}
```

---

### Freelancers

| Method | Endpoint            | Auth | Description                        |
|--------|---------------------|------|------------------------------------|
| GET    | `/freelancers`      | No   | All freelancers with stats         |
| GET    | `/freelancers/:id`  | No   | Single freelancer profile          |

---

### Client Dashboard

| Method | Endpoint        | Auth | Description              |
|--------|-----------------|------|--------------------------|
| GET    | `/client/stats` | No   | Aggregated client stats  |
| GET    | `/client/tasks` | No   | All tasks by this client |

**GET `/client/stats` response:**
```json
{
  "totalTasks": 5,
  "openTasks": 2,
  "tasksInProgress": 1,
  "totalSpent": 750
}
```

---

### Freelancer Dashboard

| Method | Endpoint                      | Auth | Description                      |
|--------|-------------------------------|------|----------------------------------|
| GET    | `/freelancer/stats`           | No   | Aggregated freelancer stats      |
| GET    | `/freelancer/active-projects` | No   | In-progress and completed tasks  |
| GET    | `/freelancer/earnings`        | No   | Earnings history                 |

**GET `/freelancer/stats` response:**
```json
{
  "totalProposals": 8,
  "pendingProposals": 3,
  "acceptedProposals": 2,
  "totalEarnings": 500
}
```

---

### Admin Dashboard

| Method | Endpoint                      | Auth | Description                  |
|--------|-------------------------------|------|------------------------------|
| GET    | `/admin/stats`                | No   | Platform-wide stats          |
| GET    | `/admin/users`                | No   | All users                    |
| GET    | `/admin/tasks`                | No   | All tasks                    |
| DELETE | `/admin/tasks/:id`            | No   | Delete any task              |
| GET    | `/admin/transactions`         | No   | All payment transactions     |
| PATCH  | `/admin/users/:id/block`      | No   | Block a user                 |
| PATCH  | `/admin/users/:id/unblock`    | No   | Unblock a user               |

---

### Reviews

| Method | Endpoint          | Auth | Description                          |
|--------|-------------------|------|--------------------------------------|
| POST   | `/reviews`        | No   | Post a review (client → freelancer)  |
| GET    | `/reviews/:email` | No   | Get all reviews for a freelancer     |

---

## User Roles

| Role         | Permissions                                              |
|--------------|----------------------------------------------------------|
| `client`     | Post tasks, manage proposals, view payments              |
| `freelancer` | Browse tasks, submit proposals, deliver work, view earnings |
| `admin`      | Full platform access, manage users and tasks             |

---

## Task Lifecycle

```
open → in_progress → completed
```

- `open` — task posted, accepting proposals
- `in_progress` — proposal accepted, freelancer working
- `completed` — freelancer submitted deliverable

---

## Project Structure

```
server/
├── index.js        # Entry point, all routes
├── .env            # Environment variables
└── package.json
```
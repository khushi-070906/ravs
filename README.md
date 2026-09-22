# Research Connect (RAVS)

> **Research Attendance & Verification System**  
> A modern, full-stack digital platform for verifying academic research attendance, approving work sessions, and managing laboratory projects.

---

## 📌 Overview

**Research Connect (RAVS)** replaces manual paper registers and spreadsheets in academic research labs. It allows students to log research hours with verified check-in/out timestamps, enables faculty to review and approve work submissions, and empowers administrators to generate semester attendance reports.

### Key Goals

- ⏱️ **Eliminate Manual Registers:** Digital check-in/check-out timers with automated session duration calculation.
- 📝 **Work Verification & File Submissions:** Students submit rich work notes and upload document proof (PDFs, images, ZIPs) for faculty review.
- 👥 **Event Members & Role Management:** Discord-style event roster sidebar with live admin role updates.
- ✅ **Faculty Approvals:** Faculty review, approve, or reject sessions and submitted files with custom remarks.
- 📊 **Automated Attendance:** Calculate total verified research hours and generate percentage reports.
- 🔐 **Role-Based Security:** Secure Row-Level Security (RLS) policies for **Student**, **Faculty**, and **Head Admin** roles.

---

## 🛠️ Tech Stack

### Frontend & UI

- **Framework:** [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Routing:** [TanStack Router](https://tanstack.com/router) (File-based type-safe routing)
- **State & Data Fetching:** [TanStack Query](https://tanstack.com/query)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)
- **Forms & Validation:** [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/)
- **Charts & Icons:** [Recharts](https://recharts.org/) + [Lucide React](https://lucide.dev/)

### Backend & Database

- **Database & Auth:** [Supabase](https://supabase.com/) (PostgreSQL + Supabase Auth)
- **Security:** PostgreSQL Row Level Security (RLS) + RBAC Triggers
- **Storage:** Supabase Storage Bucket (`work-submissions`)
- **Email Delivery:** Custom SMTP via [Resend](https://resend.com)

---

## 👥 User Roles & Permissions

| Feature / Action                     | Student | Faculty | Head Admin |
| :----------------------------------- | :-----: | :-----: | :--------: |
| **Check In / Check Out**             |   ✅    |   ❌    |     ❌     |
| **Submit Work Proof & Attachments**  |   ✅    |   ❌    |     ❌     |
| **View Personal Attendance & Hours** |   ✅    |   ✅    |     ✅     |
| **Review & Approve/Reject Sessions** |   ❌    |   ✅    |     ✅     |
| **Review & Download Submissions**    |   ❌    |   ✅    |     ✅     |
| **Create & Archive Events**          |   ❌    |   ✅    |     ✅     |
| **Manage Roster Roles in Events**    |   ❌    |   ❌    |     ✅     |
| **Manage Users & Global Roles**      |   ❌    |   ❌    |     ✅     |

---

## 📂 Project Architecture & Directory Structure

```text
research-connect-main/
├── docs/                             # Comprehensive Documentation Guides
│   ├── SUPABASE_GUIDE.md             # Supabase Schema, RLS & CLI setup
│   └── SUPABASE_SMTP_RATE_LIMITS.md  # Resend SMTP & Auth Rate Limit Guide
├── src/
│   ├── components/                   # Reusable UI & Layout Components
│   │   └── ui/                       # Radix UI + Tailwind primitives
│   ├── hooks/                        # Custom React Hooks
│   ├── lib/                          # Utility & Supabase Client instances
│   ├── routes/                       # TanStack File-Based Routes
│   │   ├── _authenticated/           # Protected App Routes
│   │   │   ├── dashboard.tsx         # Dashboard per User Role
│   │   │   ├── projects.index.tsx    # Projects Overview
│   │   │   ├── projects.$id.tsx      # Project Workspace & Timer
│   │   │   ├── approvals.tsx         # Faculty Review Queue
│   │   │   ├── attendance.tsx        # Attendance Analytics & Reports
│   │   │   └── profile.tsx           # User Profile Settings
│   │   ├── auth.tsx                  # Sign In / Sign Up
│   │   └── __root.tsx                # App Shell Layout
│   ├── main.tsx                      # Vite Application Entrypoint
│   └── styles.css                    # Tailwind CSS imports & theme definitions
├── supabase/
│   ├── migrations/                   # PostgreSQL Migration Scripts
│   └── config.toml                   # Local Supabase CLI configuration
├── .env                              # Environment Variables
├── package.json                      # Project Dependencies & Scripts
└── vite.config.ts                    # Vite Configuration
```

---

## ⚡ Getting Started (Local Development)

### 1. Prerequisites

- **Node.js** `v18+` or **Bun** / **npm**
- **Docker Desktop** _(Optional: Only if running Supabase CLI locally)_

### 2. Installation

Clone the repository and install dependencies:

```bash
# Clone the repository
git clone https://github.com/your-org/research-connect.git
cd research-connect-main

# Install dependencies
npm install
```

### 3. Environment Variables

Create a `.env` file in the root directory:

```env
SUPABASE_PROJECT_ID="your_supabase_project_id"
SUPABASE_PUBLISHABLE_KEY="your_supabase_publishable_key"
SUPABASE_URL="https://your_supabase_project_id.supabase.co"

VITE_SUPABASE_PROJECT_ID="your_supabase_project_id"
VITE_SUPABASE_PUBLISHABLE_KEY="your_supabase_publishable_key"
VITE_SUPABASE_URL="https://your_supabase_project_id.supabase.co"
```

### 4. Start Development Server

```bash
npm run dev
```

Open your browser at `http://localhost:5173`.

---

## 🗄️ Database & Security Setup

The application connects to Supabase PostgreSQL. Database tables and security policies are applied via migration files in `supabase/migrations/`.

To apply pending database migrations to your cloud instance:

```bash
# Link local CLI to Supabase Cloud
npx supabase link --project-ref your_supabase_project_id

# Push database schema migrations
npx supabase db push
```

---

## 📧 Email & Rate Limits Configuration

To prevent signup rate-limiting (`429 Too Many Requests`), the project uses **Resend Custom SMTP**:

- **Host:** `smtp.resend.com`
- **Port:** `465` (SSL/TLS)
- **Username:** `resend`
- **Email Rate Limit:** Set to `300` emails/hr in Supabase Dashboard.

For step-by-step instructions on managing rate limits and email delivery, see [docs/SUPABASE_SMTP_RATE_LIMITS.md](docs/SUPABASE_SMTP_RATE_LIMITS.md).

---

## 📖 Additional Documentation

- 🏗️ [Complete System Architecture & Developer Guide](docs/PROJECT_ARCHITECTURE.md)
- 📚 [Complete Supabase Setup & Architecture Guide](docs/SUPABASE_GUIDE.md)
- ✉️ [Supabase Auth Rate Limits & Resend SMTP Setup Guide](docs/SUPABASE_SMTP_RATE_LIMITS.md)

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

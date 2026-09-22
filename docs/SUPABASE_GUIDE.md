# Complete Supabase Setup & Architecture Guide for Research Connect (RAVS)

This document provides a comprehensive guide for configuring, deploying, and managing Supabase for the **Research Attendance & Verification System (RAVS)**.

---

## 1. Project Reference & Environment Setup

- **Project ID:** `your_supabase_project_id`
- **Project URL:** `https://your_supabase_project_id.supabase.co`

### Environment Variables (`.env`)

Place the following keys in your `.env` file in the project root:

```env
SUPABASE_PROJECT_ID="your_supabase_project_id"
SUPABASE_PUBLISHABLE_KEY="your_supabase_publishable_key"
SUPABASE_URL="https://your_supabase_project_id.supabase.co"

VITE_SUPABASE_PROJECT_ID="your_supabase_project_id"
VITE_SUPABASE_PUBLISHABLE_KEY="your_supabase_publishable_key"
VITE_SUPABASE_URL="https://your_supabase_project_id.supabase.co"
```

> ⚠️ **Security Warning:** Only `VITE_` variables should be exposed in `.env`. Secret keys (like `SUPABASE_SERVICE_ROLE_KEY` or SMTP Passwords) must never be prefixed with `VITE_`.

---

## 2. Database Schema & Migration System

All database structural changes are version-controlled under [supabase/migrations/](file:///c:/Users/admin/Desktop/work/ravs/research-connect-main/supabase/migrations).

### Core Tables

1. **`profiles`**: User profiles linked to `auth.users(id)` storing `full_name`, `college_id`, `role` (`student`, `faculty`, `head_admin`), and `department_id`.
2. **`departments`**: Academic departments managing labs and students.
3. **`laboratories`**: Research labs assigned to faculty members.
4. **`projects`**: Research projects created by faculty or admins.
5. **`project_members`**: Join table mapping students and faculty to projects.
6. **`work_sessions`**: Check-in / check-out records with live timer logs.
7. **`work_submissions`**: Student work summaries, descriptions, and attached files.
8. **`approvals`**: Faculty approval/rejection queue with remarks and hour calculations.
9. **`attendance_records`**: Verified hours and attendance percentage recommendations.
10. **`audit_logs`**: Permanent log of logins, check-ins, approvals, and role updates.

### Executing Migrations

To apply pending migrations to your live Supabase cloud database:

```bash
# Link local CLI to your cloud project
npx supabase link --project-ref your_supabase_project_id

# Push local SQL migrations to Supabase Cloud
npx supabase db push
```

---

## 3. Role-Based Access Control (RBAC) & RLS

Data security is enforced using PostgreSQL **Row Level Security (RLS)** policies.

### Roles

- **`student`**: Can check-in/out, submit work, view assigned projects, and read own attendance.
- **`faculty`**: Can create projects, review & approve/reject student work sessions, and add remarks.
- **`head_admin`**: Complete CRUD access over departments, laboratories, users, projects, and global analytics.

### Key Security Functions

- **`admin_update_user_role`**: SQL function allowing head administrators to update user roles securely without privilege escalation risks.
- **`self_grant_faculty`**: Allows users creating events to switch to faculty role, automatically cleaning up any duplicate `user_roles` entries so role queries remain single-value and accurate.
- **`handle_new_user`**: Exception-safe trigger on `auth.users` that automatically populates `public.profiles` and sets initial user roles upon signup.
- **RLS Enforcements:** Students can only read/write their own `work_sessions` and `work_submissions`. Faculty can inspect work sessions and submissions for students assigned to their events. Admins have full oversight.

---

## 4. Authentication, Custom SMTP & Rate Limits

### Custom SMTP Configuration (Resend)

To prevent signup failures and bypass Supabase's default 2 email/hour cap:

1. Navigate to **Supabase Dashboard** > **Project Settings (⚙️)** > **Authentication** > **SMTP Settings**.
2. Enable **Custom SMTP** with the following values:
   - **Host:** `smtp.resend.com`
   - **Port:** `465` (SSL/TLS)
   - **Username:** `resend`
   - **Password:** _(Your Resend API Key: `re_SAG9...`)_
   - **Sender Email:** `onboarding@resend.dev` _(or verified domain)_
   - **Sender Name:** `Research Connect`

### Auth Rate Limits

In **Authentication** > **Rate Limits**, ensure the following values are saved:

- **Email sending limit:** `300` / hour
- **Token verifications:** `300` / 5 min
- **Sign-ups and Sign-ins:** `300` / 5 min
- **Token refreshes:** `1500` / 5 min

---

## 5. Storage Buckets & File Uploads

Storage buckets are configured for research file attachments (PDF, DOCX, Images, ZIP):

- **Bucket Name:** `work-submissions`
- **Access Level:** Private (Requires authenticated session)
- **Storage RLS:**
  - Students can `INSERT` files into their assigned project folder.
  - Assigned Faculty and Admins can `SELECT` (download) submitted work files.

---

## 6. Local Development Workflow

For running and testing Supabase locally on your machine:

1. Ensure Docker Desktop is running.
2. Start local Supabase containers:
   ```bash
   npx supabase start
   ```
3. Local configuration is maintained in [supabase/config.toml](file:///c:/Users/admin/Desktop/work/ravs/research-connect-main/supabase/config.toml).
4. Local Studio UI is available at `http://localhost:54323`.

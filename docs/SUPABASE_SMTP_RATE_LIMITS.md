# Supabase Auth Rate Limits & Resend SMTP Setup Guide

This guide documents how to resolve Supabase's default email rate limits (e.g. 2–3 emails per hour), configure custom SMTP with Resend, and adjust authentication rate limits for both production and local development.

---

## 1. Executive Summary & Root Cause

By default, hosted Supabase projects use a shared, built-in SMTP service meant strictly for prototyping.

- **The Problem:** The built-in service caps email dispatch at **2–3 emails per hour** to prevent spam abuse. Users signing up or requesting password resets after this quota encounter `429 Email rate limit exceeded` errors.
- **The Fix:** Connecting a dedicated transactional email provider (**Resend**) via **Custom SMTP**. This unlocks the rate limit configuration and ensures high email deliverability directly to users' inboxes.

---

## 2. Security Architecture Note

### Public vs. Private Credentials

- **Frontend `.env` (`VITE_` variables):** Any variable starting with `VITE_` (like `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`) is bundled into the client browser code and is publicly readable via Browser Developer Tools (Inspect Element).
- **SMTP Credentials & API Keys:** SMTP passwords and provider API keys are **server secrets**. They are processed solely by Supabase's backend authentication servers (GoTrue) and must **never** be placed in client-side `.env` files with a `VITE_` prefix.

---

## 3. Step-by-Step Production Setup (Supabase Dashboard)

### Step 1: Navigate to SMTP Settings

1. Log into your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project (`your_supabase_project_id`).
3. In the left navigation menu under **NOTIFICATIONS**, click **Emails** (or navigate to **Project Settings ⚙️** > **Authentication** > **SMTP Settings**).

### Step 2: Configure Custom SMTP Credentials

1. Toggle **Enable Custom SMTP** to **ON**.
2. Enter the following SMTP credentials:

| Field            | Value                   | Notes                                                            |
| :--------------- | :---------------------- | :--------------------------------------------------------------- |
| **Sender Email** | `onboarding@resend.dev` | Default test sender _(Replace with custom domain once verified)_ |
| **Sender Name**  | `Research Connect`      | Name displayed in recipient's inbox                              |
| **Host**         | `smtp.resend.com`       | Resend SMTP server address                                       |
| **Port**         | `465`                   | SSL Port                                                         |
| **Encryption**   | `SSL / TLS`             | Implicit TLS encryption                                          |
| **Username**     | `resend`                | Default username for Resend SMTP                                 |
| **Password**     | `your_resend_api_key`   | Resend API Key                                                   |

3. Click **Save** at the bottom of the form.

### Step 3: Increase Authentication Rate Limits

1. In the left sidebar under **CONFIGURATION**, click **Rate Limits** (or go to `Authentication` > `Rate Limits`).
2. Update the rate limit thresholds according to project requirements:

| Setting                                  | Default     | Recommended Production Value |
| :--------------------------------------- | :---------- | :--------------------------- |
| **Rate limit for sending emails**        | 2 / hour    | `300` / hour                 |
| **Rate limit for sign-ups and sign-ins** | 30 / 5 min  | `300` / 5 min                |
| **Rate limit for token verifications**   | 30 / 5 min  | `300` / 5 min                |
| **Rate limit for token refreshes**       | 150 / 5 min | `1500` / 5 min               |
| **Rate limit for anonymous users**       | 30 / hour   | `300` / hour                 |

3. Click **Save**.

---

## 4. Local Development Configuration

For local development using the Supabase CLI (`supabase start`), rate limits and SMTP options are defined in [supabase/config.toml](file:///c:/Users/admin/Desktop/work/ravs/research-connect-main/supabase/config.toml):

```toml
project_id = "your_supabase_project_id"

[auth.rate_limit]
email_sent = 300
token_verifications = 300
sign_ins = 300
token_refreshes = 1500
anonymous_users = 300

[auth.smtp]
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"
pass = "your_resend_api_key"
admin_email = "onboarding@resend.dev"
sender_name = "Research Connect"
```

---

## 5. Next Steps for Custom Domain Delivery

1. **Verify your custom domain in Resend:** Log in to [Resend.com](https://resend.com), navigate to **Domains**, and add DNS records (SPF, DKIM, DMARC) for your custom domain (e.g., `researchconnect.com`).
2. **Update Sender Email:** Once verified in Resend, update the **Sender Email** field in Supabase from `onboarding@resend.dev` to `noreply@yourdomain.com`.

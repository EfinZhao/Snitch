# Snitch Backend API Endpoints

This document explains all current FastAPI endpoints in the backend, including request and response examples.

## Base URL

- Local dev base URL: `http://localhost:8000`
- API prefix: `/api`
- Full API base: `http://localhost:8000/api`

## Auth Model

Most endpoints require a bearer token in the `Authorization` header:

`Authorization: Bearer <access_token>`

Get tokens from `POST /api/auth/login`.

## Quick Start Flow

1. Create user with `POST /api/users`
2. Login with `POST /api/auth/login`
3. Use returned token for protected endpoints

---

## Health

### GET /api/health

Checks whether the backend is running.

Example:

```bash
curl http://localhost:8000/api/health
```

Example response:

```json
{
  "status": "healthy"
}
```

---

## Auth

### POST /api/auth/login

Exchanges credentials for JWT access token.

Notes:
- Uses OAuth2 password form.
- The `username` form field should contain the user email.

Form fields:
- `username` (string, email)
- `password` (string)

Example:

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=alice@example.com&password=supersecret"
```

Example response:

```json
{
  "access_token": "<jwt>",
  "token_type": "bearer"
}
```

Common errors:
- `401`: Incorrect email or password

---

## Users

### POST /api/users

Creates a new user.

Request body:

```json
{
  "email": "alice@example.com",
  "password": "supersecret",
  "username": "alice",
  "discord_uid": 123456789012345678 // This is an optional field
}
```

Example:

```bash
curl -X POST http://localhost:8000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "supersecret",
    "username": "alice",
    "discord_uid": 123456789012345678
  }'
```

Success response: `201 Created`

Common errors:
- `409`: Email or username already taken

### GET /api/users/me

Returns the currently authenticated user.

Example:

```bash
curl http://localhost:8000/api/users/me \
  -H "Authorization: Bearer <access_token>"
```

### GET /api/users/search?q=<prefix>

Finds up to 10 users whose usernames start with the query.

Notes:
- Requires authentication.
- Excludes the current user from results.
- `q` length must be 1 to 50 characters.

Example:

```bash
curl "http://localhost:8000/api/users/search?q=al" \
  -H "Authorization: Bearer <access_token>"
```

Example response:

```json
[
  {
    "id": 2,
    "username": "alex"
  },
  {
    "id": 5,
    "username": "alice2"
  }
]
```

---

## Stakes

### POST /api/stakes

Creates a new stake.

Requirements:
- Auth required
- Creator must already have a saved payment method
- `recipient_usernames` must include 1 to 5 users
- Creator cannot include themselves

Request body:

```json
{
  "amount_cents": 1000,
  "duration_seconds": 1800,
  "recipient_usernames": ["bob", "charlie"]
}
```

Example:

```bash
curl -X POST http://localhost:8000/api/stakes \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount_cents": 1000,
    "duration_seconds": 1800,
    "recipient_usernames": ["bob", "charlie"]
  }'
```

Success response: `201 Created`

Common errors:
- `400`: Missing payment method, invalid self-recipient, or validation failures
- `404`: One or more recipient usernames not found

### GET /api/stakes

Lists stakes created by the current user.

Optional query param:
- `status` one of: `pending`, `active`, `completed`, `failed`, `paid_out`, `cancelled`

Examples:

```bash
curl http://localhost:8000/api/stakes \
  -H "Authorization: Bearer <access_token>"
```

```bash
curl "http://localhost:8000/api/stakes?status=active" \
  -H "Authorization: Bearer <access_token>"
```

### GET /api/stakes/received

Lists stakes where current user is a recipient.

Example:

```bash
curl http://localhost:8000/api/stakes/received \
  -H "Authorization: Bearer <access_token>"
```

### GET /api/stakes/{stake_id}

Gets one stake by id.

Authorization:
- Caller must be the stake creator or one of its recipients.

Example:

```bash
curl http://localhost:8000/api/stakes/42 \
  -H "Authorization: Bearer <access_token>"
```

Common errors:
- `403`: Not authorized to view this stake
- `404`: Stake not found

### POST /api/stakes/{stake_id}/activate

Activates a pending stake.

Rules:
- Only creator can activate
- Stake must be `pending`

Example:

```bash
curl -X POST http://localhost:8000/api/stakes/42/activate \
  -H "Authorization: Bearer <access_token>"
```

### PATCH /api/stakes/{stake_id}

Updates active stake progress values.

Rules:
- Only creator can update
- Stake must be `active`

Request body fields (both optional):
- `distraction_count` (integer)
- `elapsed_seconds` (integer)

Example:

```bash
curl -X PATCH http://localhost:8000/api/stakes/42 \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "distraction_count": 3,
    "elapsed_seconds": 740
  }'
```

### POST /api/stakes/{stake_id}/resolve

Resolves an active stake as completed or failed.

Rules:
- Only creator can resolve
- Stake must be `active`
- On `failed`, payout amounts are currently split and stored, but transfer execution is still TODO in service code

Request body:

```json
{
  "outcome": "failed",
  "elapsed_seconds": 1800
}
```

Allowed outcomes:
- `completed`
- `failed`

Example:

```bash
curl -X POST http://localhost:8000/api/stakes/42/resolve \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "outcome": "failed",
    "elapsed_seconds": 1800
  }'
```

### DELETE /api/stakes/{stake_id}

Cancels a pending stake.

Rules:
- Only creator can cancel
- Stake must be `pending`

Example:

```bash
curl -X DELETE http://localhost:8000/api/stakes/42 \
  -H "Authorization: Bearer <access_token>"
```

---

## Payments

### POST /api/payments/setup-intent

Creates a Stripe SetupIntent for saving a payment method.

Notes:
- Auth required
- Creates Stripe customer if missing

Example:

```bash
curl -X POST http://localhost:8000/api/payments/setup-intent \
  -H "Authorization: Bearer <access_token>"
```

Example response:

```json
{
  "client_secret": "seti_..._secret_...",
  "customer_id": "cus_..."
}
```

---

## Connect

### POST /api/connect/onboarding-link

Returns a Stripe Connect onboarding link for current user.

Notes:
- Auth required
- Creates connect account if missing

Example:

```bash
curl -X POST http://localhost:8000/api/connect/onboarding-link \
  -H "Authorization: Bearer <access_token>"
```

Example response:

```json
{
  "url": "https://connect.stripe.com/..."
}
```

### GET /api/connect/status

Returns current user Stripe Connect account status.

Example:

```bash
curl http://localhost:8000/api/connect/status \
  -H "Authorization: Bearer <access_token>"
```

Example response:

```json
{
  "account_id": "acct_...",
  "charges_enabled": true,
  "payouts_enabled": true,
  "details_submitted": true
}
```

---

## Webhooks

### POST /api/webhooks/stripe

Stripe webhook endpoint.

Notes:
- Not intended for client use.
- Hidden from OpenAPI docs (`include_in_schema=False`).
- Verifies `stripe-signature` header against `STRIPE_WEBHOOK_SECRET`.
- Handles:
  - `setup_intent.succeeded`
  - `account.updated`

Example local test with Stripe CLI:

```bash
stripe listen --forward-to localhost:8000/api/webhooks/stripe
```

Then trigger an event:

```bash
stripe trigger setup_intent.succeeded
```

Common errors:
- `400`: Invalid webhook signature

---

## Typical Authenticated cURL Template

```bash
TOKEN="<paste-access-token>"

curl http://localhost:8000/api/users/me \
  -H "Authorization: Bearer $TOKEN"
```

## OpenAPI Docs

- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

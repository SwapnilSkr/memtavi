# Memtavi API reference

Generated from `packages/spec/openapi.yaml` by `packages/spec/docs.mjs`. Do not edit this
file by hand; run `bun run spec:docs`.

- OpenAPI: 3.1.0
- Version: 1.0.0
- Server: https://api.memtavi.com
- Endpoints: 43 operations across 34 paths
- Schemas: 57 component schemas

## Authentication

Every request carries `x-api-key`. Subject routes also carry `x-subject-id`,
which selects the brains that are visible. Tenant routes never accept `x-subject-id`.

| Header | Scope | Meaning |
| --- | --- | --- |
| `x-api-key` | Tenant | Tenant-scoped API key carrying a role. |
| `x-subject-id` | Subject | End-user UUID. Determines which brains are visible. |

Subject routes (require `x-subject-id`):

- `/v1/brains`
- `/v1/brains/{brainId}`
- `/v1/brains/{brainId}/captures`
- `/v1/brains/{brainId}/changes`
- `/v1/brains/{brainId}/changes/{changeId}`
- `/v1/brains/{brainId}/connections`
- `/v1/brains/{brainId}/connections/{connectionId}`
- `/v1/brains/{brainId}/export`
- `/v1/brains/{brainId}/graph`
- `/v1/brains/{brainId}/index`
- `/v1/brains/{brainId}/pages`
- `/v1/brains/{brainId}/pages/{slug}`
- `/v1/brains/{brainId}/pages/{slug}/diff`
- `/v1/brains/{brainId}/pages/{slug}/resolve`
- `/v1/brains/{brainId}/pages/{slug}/versions`
- `/v1/brains/{brainId}/pages/{slug}/versions/{version}`
- `/v1/brains/{brainId}/profile`
- `/v1/brains/{brainId}/routing-reviews`
- `/v1/brains/{brainId}/routing-reviews/{reviewId}/dismiss`
- `/v1/brains/{brainId}/routing-reviews/{reviewId}/resolve`
- `/v1/brains/{brainId}/score`
- `/v1/brains/{brainId}/score/history`
- `/v1/brains/{brainId}/score/suggestions`
- `/v1/brains/{brainId}/search`
- `/v1/brains/{brainId}/sources`
- `/v1/brains/{brainId}/sources/{sourceId}`
- `/v1/brains/{brainId}/sources/{sourceId}/content`
- `/v1/brains/{brainId}/sources/{sourceId}/retry`
- `/v1/webhooks`
- `/v1/webhooks/{webhookId}`

Tenant routes (do not accept `x-subject-id`):

- `/v1/api-keys`
- `/v1/api-keys/{keyId}`
- `/v1/members`
- `/v1/tenant`

## Contents

- [`GET /v1/api-keys`](#get-v1api-keys) — API Keys
- [`POST /v1/api-keys`](#post-v1api-keys) — API Keys
- [`DELETE /v1/api-keys/{keyId}`](#delete-v1api-keyskeyid) — API Keys
- [`GET /v1/brains`](#get-v1brains) — Brains
- [`POST /v1/brains`](#post-v1brains) — Brains
- [`GET /v1/brains/{brainId}`](#get-v1brainsbrainid) — Brains
- [`PATCH /v1/brains/{brainId}`](#patch-v1brainsbrainid) — Brains
- [`DELETE /v1/brains/{brainId}`](#delete-v1brainsbrainid) — Brains
- [`POST /v1/brains/{brainId}/captures`](#post-v1brainsbrainidcaptures) — Captures
- [`GET /v1/brains/{brainId}/changes`](#get-v1brainsbrainidchanges) — Changes
- [`PATCH /v1/brains/{brainId}/changes/{changeId}`](#patch-v1brainsbrainidchangeschangeid) — Changes
- [`GET /v1/brains/{brainId}/connections`](#get-v1brainsbrainidconnections) — Connections
- [`PATCH /v1/brains/{brainId}/connections/{connectionId}`](#patch-v1brainsbrainidconnectionsconnectionid) — Connections
- [`GET /v1/brains/{brainId}/export`](#get-v1brainsbrainidexport) — Export
- [`GET /v1/brains/{brainId}/graph`](#get-v1brainsbrainidgraph) — Search
- [`GET /v1/brains/{brainId}/index`](#get-v1brainsbrainidindex) — Search
- [`GET /v1/brains/{brainId}/pages`](#get-v1brainsbrainidpages) — Pages
- [`GET /v1/brains/{brainId}/pages/{slug}`](#get-v1brainsbrainidpagesslug) — Pages
- [`PATCH /v1/brains/{brainId}/pages/{slug}`](#patch-v1brainsbrainidpagesslug) — Pages
- [`DELETE /v1/brains/{brainId}/pages/{slug}`](#delete-v1brainsbrainidpagesslug) — Pages
- [`GET /v1/brains/{brainId}/pages/{slug}/diff`](#get-v1brainsbrainidpagesslugdiff) — Pages
- [`POST /v1/brains/{brainId}/pages/{slug}/resolve`](#post-v1brainsbrainidpagesslugresolve) — Pages
- [`GET /v1/brains/{brainId}/pages/{slug}/versions`](#get-v1brainsbrainidpagesslugversions) — Pages
- [`GET /v1/brains/{brainId}/pages/{slug}/versions/{version}`](#get-v1brainsbrainidpagesslugversionsversion) — Pages
- [`GET /v1/brains/{brainId}/profile`](#get-v1brainsbrainidprofile) — Profile
- [`PATCH /v1/brains/{brainId}/profile`](#patch-v1brainsbrainidprofile) — Profile
- [`GET /v1/brains/{brainId}/routing-reviews`](#get-v1brainsbrainidrouting-reviews) — Reviews
- [`POST /v1/brains/{brainId}/routing-reviews/{reviewId}/dismiss`](#post-v1brainsbrainidrouting-reviewsreviewiddismiss) — Reviews
- [`POST /v1/brains/{brainId}/routing-reviews/{reviewId}/resolve`](#post-v1brainsbrainidrouting-reviewsreviewidresolve) — Reviews
- [`GET /v1/brains/{brainId}/score`](#get-v1brainsbrainidscore) — Score
- [`GET /v1/brains/{brainId}/score/history`](#get-v1brainsbrainidscorehistory) — Score
- [`POST /v1/brains/{brainId}/score/suggestions`](#post-v1brainsbrainidscoresuggestions) — Score
- [`GET /v1/brains/{brainId}/search`](#get-v1brainsbrainidsearch) — Search
- [`GET /v1/brains/{brainId}/sources`](#get-v1brainsbrainidsources) — Sources
- [`GET /v1/brains/{brainId}/sources/{sourceId}`](#get-v1brainsbrainidsourcessourceid) — Sources
- [`DELETE /v1/brains/{brainId}/sources/{sourceId}`](#delete-v1brainsbrainidsourcessourceid) — Sources
- [`GET /v1/brains/{brainId}/sources/{sourceId}/content`](#get-v1brainsbrainidsourcessourceidcontent) — Sources
- [`POST /v1/brains/{brainId}/sources/{sourceId}/retry`](#post-v1brainsbrainidsourcessourceidretry) — Sources
- [`GET /v1/members`](#get-v1members) — Members
- [`GET /v1/tenant`](#get-v1tenant) — Tenant
- [`GET /v1/webhooks`](#get-v1webhooks) — Webhooks
- [`POST /v1/webhooks`](#post-v1webhooks) — Webhooks
- [`DELETE /v1/webhooks/{webhookId}`](#delete-v1webhookswebhookid) — Webhooks
- [Schema reference](#schema-reference)
  - [`AckRequest`](#ackrequest)
  - [`ApiKey`](#apikey)
  - [`ApiKeyCreate`](#apikeycreate)
  - [`Brain`](#brain)
  - [`BrainCreate`](#braincreate)
  - [`BrainUpdate`](#brainupdate)
  - [`Bucket`](#bucket)
  - [`BucketSource`](#bucketsource)
  - [`Capture`](#capture)
  - [`CaptureKind`](#capturekind)
  - [`ChangeAction`](#changeaction)
  - [`ChangeActor`](#changeactor)
  - [`ChangeEvent`](#changeevent)
  - [`Connection`](#connection)
  - [`ConnectionSource`](#connectionsource)
  - [`ConnectionStrength`](#connectionstrength)
  - [`DeletionReceipt`](#deletionreceipt)
  - [`DeletionState`](#deletionstate)
  - [`ErrorEnvelope`](#errorenvelope)
  - [`ExportedPageVersion`](#exportedpageversion)
  - [`Graph`](#graph)
  - [`GraphEdge`](#graphedge)
  - [`GraphNode`](#graphnode)
  - [`IndexEntry`](#indexentry)
  - [`IngestSource`](#ingestsource)
  - [`Member`](#member)
  - [`MemberRole`](#memberrole)
  - [`Page`](#page)
  - [`PageResolve`](#pageresolve)
  - [`PageStatus`](#pagestatus)
  - [`PageType`](#pagetype)
  - [`PageUpdate`](#pageupdate)
  - [`PageVersion`](#pageversion)
  - [`PageVersionDiff`](#pageversiondiff)
  - [`PageVersionDiffLine`](#pageversiondiffline)
  - [`PageVersionField`](#pageversionfield)
  - [`PageVersionHunk`](#pageversionhunk)
  - [`PageVersionSummary`](#pageversionsummary)
  - [`Profile`](#profile)
  - [`ProfileUpdate`](#profileupdate)
  - [`RoutingReview`](#routingreview)
  - [`RoutingReviewDismiss`](#routingreviewdismiss)
  - [`RoutingReviewList`](#routingreviewlist)
  - [`RoutingReviewResolve`](#routingreviewresolve)
  - [`Score`](#score)
  - [`ScoreHistory`](#scorehistory)
  - [`ScorePoint`](#scorepoint)
  - [`ScoreRange`](#scorerange)
  - [`ScoreSuggestion`](#scoresuggestion)
  - [`ScoreSuggestions`](#scoresuggestions)
  - [`SearchHit`](#searchhit)
  - [`SourceContentUrl`](#sourcecontenturl)
  - [`SourceStatus`](#sourcestatus)
  - [`TargetType`](#targettype)
  - [`Tenant`](#tenant)
  - [`Webhook`](#webhook)
  - [`WebhookCreate`](#webhookcreate)

## Endpoints

### GET /v1/api-keys

`listApiKeys` · Tags: API Keys

List API keys

Requires admin or higher. Never returns plaintext keys or hashes.

**Security:** `x-api-key`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | API keys for the tenant, without their secrets. | `object { items: ApiKey[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### POST /v1/api-keys

`createApiKey` · Tags: API Keys

Create an API key

Requires admin or higher. The role defaults to viewer and cannot exceed the caller's role. The plaintext key is returned once in the `key` field of this response.

**Security:** `x-api-key`

**Request body** (required)

`ApiKeyCreate` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 201 | The new API key and its plaintext value. | `ApiKey` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### DELETE /v1/api-keys/{keyId}

`deleteApiKey` · Tags: API Keys

Revoke an API key

Requires admin or higher. Revocation takes effect on the next request.

**Security:** `x-api-key`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `keyId` | path | yes | `string (uuid)` | API key UUID. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 204 | The API key was revoked. | — |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains

`listBrains` · Tags: Brains

List brains

Lists the brains visible to the subject in `x-subject-id`.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Brains visible to the subject. | `object { items: Brain[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### POST /v1/brains

`createBrain` · Tags: Brains

Create a brain

Creates a brain for the subject in `x-subject-id`. Requires developer or higher.

**Security:** `x-api-key` + `x-subject-id`

**Request body** (required)

`BrainCreate` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 201 | The brain was created. | `Brain` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 409 | Conflict with the current state, such as a page version conflict or a duplicate slug. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}

`getBrain` · Tags: Brains

Get a brain

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The brain. | `Brain` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### PATCH /v1/brains/{brainId}

`updateBrain` · Tags: Brains

Update a brain

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |

**Request body** (required)

`BrainUpdate` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The updated brain. | `Brain` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### DELETE /v1/brains/{brainId}

`deleteBrain` · Tags: Brains

Delete a brain

Accepts an asynchronous deletion of the brain and everything under it.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 202 | Deletion accepted for asynchronous processing. | `DeletionReceipt` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### POST /v1/brains/{brainId}/captures

`createCapture` · Tags: Captures

Capture material

Submits one capture for compilation. Supply exactly one of `content` or `fetchUrl`;
supplying both returns `400`. The capture is queued, not compiled in the request.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `Idempotency-Key` | header | no | `string` | Client-generated key. A replay within 24 hours returns the original response byte-for-byte. Minimum length 1. Maximum length 200. |

**Request body** (required)

`Capture` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | A source with the same `originRef` already exists and is returned. | `IngestSource` |
| 201 | The capture was accepted and queued. | `IngestSource` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 409 | Conflict with the current state, such as a page version conflict or a duplicate slug. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/changes

`listChanges` · Tags: Changes

List change events

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Change events for the brain, newest first. | `object { items: ChangeEvent[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### PATCH /v1/brains/{brainId}/changes/{changeId}

`ackChange` · Tags: Changes

Acknowledge a change event

Marks the change event as seen. Acknowledging is idempotent.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `changeId` | path | yes | `string` | Prefixed change event id, `chg_` followed by 32 lowercase hex characters. Matches `^chg_[0-9a-f]{32}$`. |

**Request body** (required)

`AckRequest` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The acknowledged change event. | `ChangeEvent` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/connections

`listConnections` · Tags: Connections

List connections

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Connections in the brain. | `object { items: Connection[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### PATCH /v1/brains/{brainId}/connections/{connectionId}

`ackConnection` · Tags: Connections

Acknowledge a connection

Marks the connection as seen. Acknowledging is idempotent.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `connectionId` | path | yes | `string` | Prefixed connection id, `cnn_` followed by 32 lowercase hex characters. Matches `^cnn_[0-9a-f]{32}$`. |

**Request body** (required)

`AckRequest` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The acknowledged connection. | `Connection` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/export

`exportBrain` · Tags: Export

Export a brain

Returns the brain and its pages, versions, sources and connections.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The exported brain. | `object { brain: Brain, pages: Page[], versions: ExportedPageVersion[], sources: IngestSource[], connections: Connection[] }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/graph

`getGraph` · Tags: Search

Get the brain graph

Returns the page nodes and connection edges of the brain.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The graph. | `Graph` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/index

`getIndex` · Tags: Search

Get the brain index

Returns the compact index of pages in the brain.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `limit` | query | no | `integer` | Maximum number of index entries to return. Default `40`. Minimum 1. Maximum 200. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Index entries for the brain. | `object { items: IndexEntry[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/pages

`listPages` · Tags: Pages

List pages

Lists pages without bumping `lastReferencedAt`.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |
| `status` | query | no | [`PageStatus`](#pagestatus) | Only return pages with this status. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Pages in the brain. | `object { items: Page[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/pages/{slug}

`getPage` · Tags: Pages

Get a page by slug

Reads the page and bumps `lastReferencedAt`. It is a consumption signal, not a
list hydrator, so list endpoints do not bump it.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `slug` | path | yes | `string` | The page slug within the brain. Minimum length 1. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The page. | `Page` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### PATCH /v1/brains/{brainId}/pages/{slug}

`updatePage` · Tags: Pages

Update a page

Applies a user edit and records a new page version. Sending a `version` that is not
the current version returns `409`.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `slug` | path | yes | `string` | The page slug within the brain. Minimum length 1. |

**Request body** (required)

`PageUpdate` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The updated page. | `Page` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 409 | Conflict with the current state, such as a page version conflict or a duplicate slug. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### DELETE /v1/brains/{brainId}/pages/{slug}

`deletePage` · Tags: Pages

Delete a page permanently

Permanently deletes the page. `permanent=true` is a required confirmation, not a
soft-delete flag.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `slug` | path | yes | `string` | The page slug within the brain. Minimum length 1. |
| `permanent` | query | yes | `boolean` | Confirmation that the page is deleted permanently. Must be `true`. Must be `true`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 202 | Deletion accepted for asynchronous processing. | `DeletionReceipt` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/pages/{slug}/diff

`diffPageVersions` · Tags: Pages

Diff two page versions

Line-based unified diff of `body` between two versions, with three lines of context.
`from` is required and `to` defaults to the page's current version. A missing or
malformed `from`, or a `from` that is greater than or equal to `to`, answers `400`.
A page or version that does not exist answers `404`. Bodies larger than 5,000 lines on
either side answer `400` rather than doing unbounded diff work. Reading versions does
not bump `lastReferencedAt`.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `slug` | path | yes | `string` | The page slug within the brain. Minimum length 1. |
| `from` | query | yes | `integer` | The older version. Minimum 1. |
| `to` | query | no | `integer` | The newer version. Defaults to the page's current version. Minimum 1. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The diff between the two versions. | `PageVersionDiff` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### POST /v1/brains/{brainId}/pages/{slug}/resolve

`resolvePage` · Tags: Pages

Resolve a contested page

Resolves a contested page with a note and returns it to `active`. When `title`,
`summary` or `body` is supplied, a new immutable version is recorded first. A page
that is not `contested` returns `409`.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `slug` | path | yes | `string` | The page slug within the brain. Minimum length 1. |

**Request body** (required)

`PageResolve` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The resolved page. | `Page` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 409 | Conflict with the current state, such as a page version conflict or a duplicate slug. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/pages/{slug}/versions

`listPageVersions` · Tags: Pages

List page versions

Lists the immutable version history of a page, newest first, without bodies.
Reading versions does not bump `lastReferencedAt`; only `getPage` does.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `slug` | path | yes | `string` | The page slug within the brain. Minimum length 1. |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Page versions, newest first. | `object { items: PageVersionSummary[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/pages/{slug}/versions/{version}

`getPageVersion` · Tags: Pages

Get a page version

Returns one immutable page version, including its body. Reading a version does not
bump `lastReferencedAt`.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `slug` | path | yes | `string` | The page slug within the brain. Minimum length 1. |
| `version` | path | yes | `integer` | The page version number. Minimum 1. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The page version. | `PageVersion` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/profile

`getProfile` · Tags: Profile

Get the subject profile

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The profile attached to the brain. | `Profile` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### PATCH /v1/brains/{brainId}/profile

`updateProfile` · Tags: Profile

Update the subject profile

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |

**Request body** (required)

`ProfileUpdate` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The updated profile. | `Profile` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/routing-reviews

`listRoutingReviews` · Tags: Reviews

List routing reviews

Requires viewer or higher. Deleted candidates are omitted. Reviews are newest first.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |
| `status` | query | no | `string` | One of `open`, `resolved`, `dismissed`. Default `open`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | List routing reviews. | `RoutingReviewList` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### POST /v1/brains/{brainId}/routing-reviews/{reviewId}/dismiss

`dismissRoutingReview` · Tags: Reviews

Dismiss a routing review

Requires developer or higher. Settles an open review without deleting the source fact.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `reviewId` | path | yes | `string (uuid)` | Routing review identifier. |

**Request body** (optional)

`RoutingReviewDismiss` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Dismiss a routing review. | `RoutingReview` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 409 | Conflict with the current state, such as a page version conflict or a duplicate slug. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### POST /v1/brains/{brainId}/routing-reviews/{reviewId}/resolve

`resolveRoutingReview` · Tags: Reviews

Resolve a routing review

Requires developer or higher. Atomically settles an open review and queues review.apply. The selected page must be an active candidate. Placement uses compiler patching, evidence, budget caps and embeddings. A 202 confirms the decision; placement runs asynchronously.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `reviewId` | path | yes | `string (uuid)` | Routing review identifier. |

**Request body** (required)

`RoutingReviewResolve` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 202 | Resolve a routing review. | `RoutingReview` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 409 | Conflict with the current state, such as a page version conflict or a duplicate slug. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/score

`getScore` · Tags: Score

Get the brain score

Returns the latest score snapshot for the brain.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The latest score snapshot. | `Score` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/score/history

`getScoreHistory` · Tags: Score

Get score history

Returns at most one snapshot per UTC day, keeping the latest snapshot of each day,
oldest first. `delta` is the last point minus the first point and is `null` when
fewer than two points fall inside the range.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `range` | query | no | [`ScoreRange`](#scorerange) | The window to summarise, in whole days back from now. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Daily score snapshots and their delta. | `ScoreHistory` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### POST /v1/brains/{brainId}/score/suggestions

`getScoreSuggestions` · Tags: Score

Suggest score improvements

Applies a deterministic rule set to the latest snapshot, computing one when the brain
has none. Items are ordered by priority and then by key. Requires viewer or higher.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Rule-based suggestions for the brain. | `ScoreSuggestions` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/search

`searchBrain` · Tags: Search

Search a brain

Keyword matches bypass `minSimilarity`; semantic-only matches do not. `similarity`
carries the vector score only, so results can appear out of similarity order.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `q` | query | yes | `string` | The search phrase. Minimum length 1. |
| `limit` | query | no | `integer` | Maximum number of search hits to return. Default `50`. Minimum 1. Maximum 200. |
| `minSimilarity` | query | no | `number` | Lowest vector similarity to return for semantic-only matches. Minimum 0. Maximum 1. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Ranked search hits. | `object { items: SearchHit[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/sources

`listIngestSources` · Tags: Sources

List ingest sources

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Ingest sources for the brain. | `object { items: IngestSource[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/sources/{sourceId}

`getIngestSource` · Tags: Sources

Get an ingest source

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `sourceId` | path | yes | `string` | Prefixed ingest source id, `src_` followed by 32 lowercase hex characters. Matches `^src_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The ingest source. | `IngestSource` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### DELETE /v1/brains/{brainId}/sources/{sourceId}

`deleteIngestSource` · Tags: Sources

Delete an ingest source

Deletes the source. Pages derived from it stay in place.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `sourceId` | path | yes | `string` | Prefixed ingest source id, `src_` followed by 32 lowercase hex characters. Matches `^src_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 202 | Deletion accepted for asynchronous processing. | `DeletionReceipt` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/brains/{brainId}/sources/{sourceId}/content

`getSourceContent` · Tags: Sources

Get a short-lived URL for a source body

Returns a signed URL that expires after 300 seconds. `url` and `expiresAt` are
`null` when the configured object store cannot sign. A source without a stored
body returns `404`.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `sourceId` | path | yes | `string` | Prefixed ingest source id, `src_` followed by 32 lowercase hex characters. Matches `^src_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | A short-lived URL for the stored source body. | `SourceContentUrl` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### POST /v1/brains/{brainId}/sources/{sourceId}/retry

`retryIngestSource` · Tags: Sources

Retry a failed ingest source

Queues another attempt for a source whose status is `failed`, keeping the same source id.
The status returns to `pending` and `lastError` is cleared. `attempts` counts accepted
retries and is never reset. When the stored body or chunks exist the source is recompiled;
otherwise the original fetch is repeated. Storage usage is not counted again. Requires
developer or higher.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `brainId` | path | yes | `string` | Prefixed brain id, `brn_` followed by 32 lowercase hex characters. Matches `^brn_[0-9a-f]{32}$`. |
| `sourceId` | path | yes | `string` | Prefixed ingest source id, `src_` followed by 32 lowercase hex characters. Matches `^src_[0-9a-f]{32}$`. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 202 | The source was requeued with status `pending`. | `IngestSource` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 409 | Conflict with the current state, such as a page version conflict or a duplicate slug. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/members

`listMembers` · Tags: Members

List members

**Security:** `x-api-key`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Members of the tenant. | `object { items: Member[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/tenant

`getTenant` · Tags: Tenant

Get the current tenant

Requires owner.

**Security:** `x-api-key`

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | The tenant that owns the API key. | `Tenant` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 403 | The key role does not permit this operation or granting a higher role. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### GET /v1/webhooks

`listWebhooks` · Tags: Webhooks

List webhooks

Lists webhooks registered for the subject in `x-subject-id`.

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `limit` | query | no | `integer` | Maximum number of items to return. Default `50`. Minimum 1. Maximum 200. |
| `offset` | query | no | `integer` | Number of items to skip before collecting the page. Default `0`. Minimum 0. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 200 | Webhooks for the subject. | `object { items: Webhook[], total: integer, limit: integer, offset: integer }` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### POST /v1/webhooks

`createWebhook` · Tags: Webhooks

Create a webhook

Registers a webhook for the subject in `x-subject-id` and returns its signing secret exactly once.

**Security:** `x-api-key` + `x-subject-id`

**Request body** (required)

`WebhookCreate` (`application/json`)

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 201 | The webhook was created. The response carries the plaintext `secret` once; it is never returned again. | `Webhook` |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 422 | The request is well formed but semantically invalid. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

### DELETE /v1/webhooks/{webhookId}

`deleteWebhook` · Tags: Webhooks

Delete a webhook

**Security:** `x-api-key` + `x-subject-id`

**Parameters**

| Name | In | Required | Type | Notes |
| --- | --- | --- | --- | --- |
| `webhookId` | path | yes | `string (uuid)` | Webhook UUID. |

**Responses**

| Status | Description | Schema |
| --- | --- | --- |
| 204 | The webhook was deleted. | — |
| 400 | Malformed body, a wrong enum, both `content` and `fetchUrl`, or a malformed subject id. | `ErrorEnvelope` |
| 401 | Missing, unknown, expired or revoked API key. | `ErrorEnvelope` |
| 404 | Not found, or owned by another tenant. Cross-tenant access is 404, never 403. | `ErrorEnvelope` |
| 429 | Rate limited. Retry after the number of seconds in `Retry-After`. | `ErrorEnvelope` |
| 500 | Unexpected server error. Never used for a provider's error. | `ErrorEnvelope` |

## Schema reference

### AckRequest

Required: `acked`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `acked` | `boolean` | yes | Default `true`. |

### ApiKey

Required: `id`, `name`, `prefix`, `role`, `scopes`, `lastUsedAt`, `expiresAt`, `revokedAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string (uuid)` | yes |  |
| `name` | `string` | yes |  |
| `prefix` | `string` | yes |  |
| `role` | [`MemberRole`](#memberrole) | yes |  |
| `scopes` | `string[]` | yes |  |
| `lastUsedAt` | `string (date-time) \| null` | yes |  |
| `expiresAt` | `string (date-time) \| null` | yes |  |
| `revokedAt` | `string (date-time) \| null` | yes |  |
| `key` | `string` | no | Plaintext key, present only in the creation response. |

### ApiKeyCreate

Required: `name`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | `string` | yes | Minimum length 1. Maximum length 200. |
| `role` | [`MemberRole`](#memberrole) | no |  |
| `scopes` | `string[]` | no |  |
| `expiresAt` | `string (date-time) \| null` | no |  |

### Brain

A subject's memory store.

Required: `id`, `subjectId`, `projectId`, `name`, `slug`, `description`, `briefSettings`, `deletionState`, `createdAt`, `updatedAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes | Prefixed brain id, `brn_...`. |
| `subjectId` | `string (uuid)` | yes |  |
| `projectId` | `string (uuid) \| null` | yes |  |
| `name` | `string` | yes |  |
| `slug` | `string` | yes |  |
| `description` | `string` | yes |  |
| `briefSettings` | `object` | yes | Free-form object. |
| `deletionState` | [`DeletionState`](#deletionstate) | yes |  |
| `createdAt` | `string (date-time)` | yes |  |
| `updatedAt` | `string (date-time)` | yes |  |

### BrainCreate

Required: `name`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | `string` | yes | Minimum length 1. Maximum length 200. |
| `slug` | `string` | no | Minimum length 1. |
| `description` | `string` | no |  |
| `projectId` | `string (uuid) \| null` | no |  |
| `briefSettings` | `object` | no | Free-form object. |

### BrainUpdate

Required: none

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | `string` | no | Minimum length 1. Maximum length 200. |
| `description` | `string` | no |  |
| `projectId` | `string (uuid) \| null` | no |  |
| `briefSettings` | `object` | no | Free-form object. |

### Bucket

Type: `string`

One of `inbox`, `notes`, `ideas`, `projects`.

### BucketSource

Type: `string`

One of `auto`, `user`.

### Capture

One unit of raw material. Supply exactly one of `content` or `fetchUrl`.

Required: `kind`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | [`CaptureKind`](#capturekind) | yes |  |
| `content` | `string \| null` | no | Maximum length 50000. |
| `fetchUrl` | `string (uri) \| null` | no |  |
| `originRef` | `string \| null` | no |  |
| `label` | `string \| null` | no |  |
| `bucket` | [`Bucket`](#bucket) | no |  |
| `metadata` | `object` | no | Free-form object. |

### CaptureKind

Type: `string`

One of `note`, `url`, `file`, `transcript`, `chat_turn`, `integration`.

### ChangeAction

Type: `string`

One of `created`, `updated`, `renamed`, `merged`, `split`, `archived`, `restored`, `recovered`, `routed`.

### ChangeActor

Type: `string`

One of `compiler`, `user`.

### ChangeEvent

Required: `id`, `brainId`, `pageId`, `action`, `changeSummary`, `fromVersion`, `toVersion`, `ingestSourceId`, `contradictions`, `ackedAt`, `createdAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes | Prefixed change id, `chg_...`. |
| `brainId` | `string` | yes |  |
| `pageId` | `string` | yes |  |
| `action` | [`ChangeAction`](#changeaction) | yes |  |
| `changeSummary` | `string` | yes |  |
| `fromVersion` | `integer \| null` | yes |  |
| `toVersion` | `integer` | yes |  |
| `ingestSourceId` | `string \| null` | yes |  |
| `contradictions` | `unknown[]` | yes |  |
| `ackedAt` | `string (date-time) \| null` | yes |  |
| `createdAt` | `string (date-time)` | yes |  |

### Connection

A semantic link between two pages, stored in canonical page order.

Required: `id`, `brainId`, `pageAId`, `pageBId`, `similarity`, `strength`, `reasoning`, `source`, `ackedAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes | Prefixed connection id, `cnn_...`. |
| `brainId` | `string` | yes |  |
| `pageAId` | `string` | yes |  |
| `pageBId` | `string` | yes |  |
| `similarity` | `number` | yes |  |
| `strength` | [`ConnectionStrength`](#connectionstrength) | yes |  |
| `reasoning` | `string` | yes |  |
| `source` | [`ConnectionSource`](#connectionsource) | yes |  |
| `ackedAt` | `string (date-time) \| null` | yes |  |

### ConnectionSource

Type: `string`

One of `auto`, `manual`.

### ConnectionStrength

Type: `string`

One of `weak`, `medium`, `strong`.

### DeletionReceipt

Required: `id`, `targetType`, `state`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes |  |
| `targetType` | [`TargetType`](#targettype) | yes |  |
| `state` | `string` | yes |  |

### DeletionState

Type: `string`

One of `active`, `deleting`, `deleted`.

### ErrorEnvelope

The one error shape used by every error response.

Required: `statusCode`, `timestamp`, `path`, `message`, `body`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `statusCode` | `integer` | yes |  |
| `timestamp` | `string (date-time)` | yes |  |
| `path` | `string` | yes |  |
| `message` | `string` | yes |  |
| `body` | `object { message: string, error: string, statusCode: integer }` | yes |  |

### ExportedPageVersion

A page version as returned by the brain export.

Required: `id`, `pageId`, `version`, `title`, `summary`, `body`, `actor`, `createdAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string (uuid)` | yes |  |
| `pageId` | `string` | yes |  |
| `version` | `integer` | yes | Minimum 1. |
| `title` | `string` | yes |  |
| `summary` | `string` | yes |  |
| `body` | `string` | yes |  |
| `ingestSourceId` | `string \| null` | no |  |
| `actor` | [`ChangeActor`](#changeactor) | yes |  |
| `createdAt` | `string (date-time)` | yes |  |

### Graph

Required: `nodes`, `edges`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `nodes` | `GraphNode[]` | yes |  |
| `edges` | `GraphEdge[]` | yes |  |

### GraphEdge

Required: `connectionId`, `pageAId`, `pageBId`, `similarity`, `strength`, `source`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `connectionId` | `string` | yes |  |
| `pageAId` | `string` | yes |  |
| `pageBId` | `string` | yes |  |
| `similarity` | `number` | yes |  |
| `strength` | [`ConnectionStrength`](#connectionstrength) | yes |  |
| `source` | [`ConnectionSource`](#connectionsource) | yes |  |

### GraphNode

Required: `id`, `slug`, `title`, `pageType`, `bucket`, `status`, `pinned`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes |  |
| `slug` | `string` | yes |  |
| `title` | `string` | yes |  |
| `pageType` | [`PageType`](#pagetype) | yes |  |
| `bucket` | [`Bucket`](#bucket) | yes |  |
| `status` | [`PageStatus`](#pagestatus) | yes |  |
| `pinned` | `boolean` | yes |  |

### IndexEntry

A compact page entry in the brain index.

Required: `slug`, `title`, `summary`, `pageType`, `pinned`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `slug` | `string` | yes |  |
| `title` | `string` | yes |  |
| `summary` | `string` | yes |  |
| `pageType` | [`PageType`](#pagetype) | yes |  |
| `pinned` | `boolean` | yes |  |
| `updatedAt` | `string (date-time)` | no |  |

### IngestSource

A stored capture and its compilation status.

Required: `id`, `brainId`, `kind`, `contentPreview`, `contentUrl`, `contentHash`, `originRef`, `label`, `bucket`, `metadata`, `status`, `attempts`, `lastError`, `affectedPageIds`, `originalBytes`, `createdAt`, `compiledAt`, `deletedAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes | Prefixed source id, `src_...`. |
| `brainId` | `string` | yes |  |
| `kind` | [`CaptureKind`](#capturekind) | yes |  |
| `contentPreview` | `string` | yes |  |
| `contentUrl` | `string \| null` | yes |  |
| `contentHash` | `string` | yes |  |
| `originRef` | `string \| null` | yes |  |
| `label` | `string \| null` | yes |  |
| `bucket` | [`Bucket`](#bucket) | yes |  |
| `metadata` | `object` | yes | Free-form object. |
| `status` | [`SourceStatus`](#sourcestatus) | yes |  |
| `attempts` | `integer` | yes | Minimum 0. |
| `lastError` | `string \| null` | yes |  |
| `affectedPageIds` | `string[]` | yes |  |
| `originalBytes` | `integer` | yes | Minimum 0. |
| `createdAt` | `string (date-time)` | yes |  |
| `compiledAt` | `string (date-time) \| null` | yes |  |
| `deletedAt` | `string (date-time) \| null` | yes |  |

### Member

Required: `id`, `email`, `name`, `image`, `role`, `createdAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string (uuid)` | yes |  |
| `email` | `string (email)` | yes |  |
| `name` | `string` | yes |  |
| `image` | `string (uri) \| null` | yes |  |
| `role` | [`MemberRole`](#memberrole) | yes |  |
| `createdAt` | `string (date-time)` | yes |  |

### MemberRole

Type: `string`

One of `owner`, `admin`, `developer`, `viewer`.

### Page

One compiled knowledge page.

Required: `id`, `subjectId`, `brainId`, `slug`, `title`, `summary`, `body`, `pageType`, `bucket`, `bucketSource`, `status`, `pinned`, `archived`, `version`, `entities`, `backlinks`, `contentHash`, `embeddingModel`, `lastCompiledAt`, `lastReferencedAt`, `userEditedAt`, `deletionState`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes | Prefixed page id, `pg_...`. |
| `subjectId` | `string (uuid)` | yes |  |
| `brainId` | `string` | yes |  |
| `slug` | `string` | yes |  |
| `title` | `string` | yes |  |
| `summary` | `string` | yes |  |
| `body` | `string` | yes |  |
| `pageType` | [`PageType`](#pagetype) | yes |  |
| `bucket` | [`Bucket`](#bucket) | yes |  |
| `bucketSource` | [`BucketSource`](#bucketsource) | yes |  |
| `status` | [`PageStatus`](#pagestatus) | yes |  |
| `pinned` | `boolean` | yes |  |
| `archived` | `boolean` | yes |  |
| `version` | `integer` | yes | Minimum 1. |
| `entities` | `string[]` | yes |  |
| `backlinks` | `string[]` | yes |  |
| `contentHash` | `string` | yes |  |
| `embeddingModel` | `string \| null` | yes |  |
| `lastCompiledAt` | `string (date-time) \| null` | yes |  |
| `lastReferencedAt` | `string (date-time) \| null` | yes |  |
| `userEditedAt` | `string (date-time) \| null` | yes |  |
| `deletionState` | [`DeletionState`](#deletionstate) | yes |  |

### PageResolve

A human decision that resolves a contested page.

Required: `note`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `note` | `string` | yes | Why the page was resolved. Recorded as the change summary. Minimum length 1. Maximum length 2000. |
| `title` | `string` | no |  |
| `summary` | `string` | no |  |
| `body` | `string` | no |  |

### PageStatus

Type: `string`

One of `active`, `stale`, `contested`, `deprecated`, `archived`.

### PageType

Type: `string`

One of `source`, `topic`, `entity`, `project`, `decision`, `brief`.

### PageUpdate

Required: none

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `title` | `string` | no |  |
| `summary` | `string` | no |  |
| `body` | `string` | no |  |
| `bucket` | [`Bucket`](#bucket) | no |  |
| `pinned` | `boolean` | no |  |
| `archived` | `boolean` | no |  |
| `status` | [`PageStatus`](#pagestatus) | no |  |
| `version` | `integer` | no | The version the client last read. A mismatch returns `409`. Minimum 1. |

### PageVersion

One immutable page version, including its body.

Required: `version`, `title`, `summary`, `body`, `actor`, `ingestSourceId`, `createdAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `version` | `integer` | yes | Minimum 1. |
| `title` | `string` | yes |  |
| `summary` | `string` | yes |  |
| `body` | `string` | yes |  |
| `actor` | [`ChangeActor`](#changeactor) | yes |  |
| `ingestSourceId` | `string \| null` | yes |  |
| `createdAt` | `string (date-time)` | yes |  |

### PageVersionDiff

A line-based unified diff between two page versions.

Required: `from`, `to`, `title`, `summary`, `hunks`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | `integer` | yes | Minimum 1. |
| `to` | `integer` | yes | Minimum 1. |
| `title` | [`PageVersionField`](#pageversionfield) | yes |  |
| `summary` | [`PageVersionField`](#pageversionfield) | yes |  |
| `hunks` | `PageVersionHunk[]` | yes |  |

### PageVersionDiffLine

Required: `op`, `text`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `op` | `string` | yes | One of `context`, `add`, `remove`. |
| `text` | `string` | yes |  |

### PageVersionField

Required: `from`, `to`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `from` | `string` | yes |  |
| `to` | `string` | yes |  |

### PageVersionHunk

Required: `oldStart`, `oldLines`, `newStart`, `newLines`, `lines`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `oldStart` | `integer` | yes | Minimum 0. |
| `oldLines` | `integer` | yes | Minimum 0. |
| `newStart` | `integer` | yes | Minimum 0. |
| `newLines` | `integer` | yes | Minimum 0. |
| `lines` | `PageVersionDiffLine[]` | yes |  |

### PageVersionSummary

One immutable page version without its body.

Required: `version`, `title`, `summary`, `actor`, `ingestSourceId`, `createdAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `version` | `integer` | yes | Minimum 1. |
| `title` | `string` | yes |  |
| `summary` | `string` | yes |  |
| `actor` | [`ChangeActor`](#changeactor) | yes |  |
| `ingestSourceId` | `string \| null` | yes |  |
| `createdAt` | `string (date-time)` | yes |  |

### Profile

The subject profile that steers compilation.

Required: `brainId`, `whoTheyAre`, `whatTheyDo`, `focus`, `goals`, `currentProjects`, `stuckOn`, `vaultOrganization`, `directives`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `brainId` | `string` | yes |  |
| `whoTheyAre` | `string` | yes |  |
| `whatTheyDo` | `string` | yes |  |
| `focus` | `string` | yes |  |
| `goals` | `string` | yes |  |
| `currentProjects` | `string` | yes |  |
| `stuckOn` | `string` | yes |  |
| `vaultOrganization` | `string` | yes |  |
| `directives` | `object` | yes | Free-form object. |

### ProfileUpdate

Required: none

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `whoTheyAre` | `string` | no |  |
| `whatTheyDo` | `string` | no |  |
| `focus` | `string` | no |  |
| `goals` | `string` | no |  |
| `currentProjects` | `string` | no |  |
| `stuckOn` | `string` | no |  |
| `vaultOrganization` | `string` | no |  |
| `directives` | `object` | no | Free-form object. |

### RoutingReview

Required: `id`, `sourceId`, `fact`, `candidates`, `bestGap`, `status`, `resolution`, `createdAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string (uuid)` | yes |  |
| `sourceId` | `string` | yes |  |
| `fact` | `object { claim: string, entities: string[], evidence: object { chunkUuid: string (uuid), charStart: integer, charEnd: integer, quote: string } }` | yes |  |
| `candidates` | `object { pageId: string, slug: string, title: string }[]` | yes |  |
| `bestGap` | `number \| null` | yes |  |
| `status` | `string` | yes | One of `open`, `resolved`, `dismissed`. |
| `resolution` | `string \| null` | yes | Optional human note about the decision. |
| `createdAt` | `string (date-time)` | yes |  |

### RoutingReviewDismiss

Required: none

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `note` | `string` | no | Maximum length 2000. |

### RoutingReviewList

Required: `items`, `total`, `limit`, `offset`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `items` | `RoutingReview[]` | yes |  |
| `total` | `integer` | yes |  |
| `limit` | `integer` | yes |  |
| `offset` | `integer` | yes |  |

### RoutingReviewResolve

Type: `unknown`

### Score

The latest health snapshot for a brain.

Required: `brainId`, `computedAt`, `freshness`, `readiness`, `strain`, `factors`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `brainId` | `string` | yes |  |
| `computedAt` | `string (date-time)` | yes |  |
| `freshness` | `number` | yes |  |
| `readiness` | `number` | yes |  |
| `strain` | `number` | yes |  |
| `factors` | `object` | yes | Free-form object. |

### ScoreHistory

Daily health snapshots for a brain, oldest first.

Required: `range`, `points`, `delta`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `range` | [`ScoreRange`](#scorerange) | yes |  |
| `points` | `ScorePoint[]` | yes |  |
| `delta` | `object { freshness: number, readiness: number, strain: number }` | yes | The last point minus the first point, or `null` when fewer than two points fall inside the range. |

### ScorePoint

One day's health snapshot.

Required: `computedAt`, `freshness`, `readiness`, `strain`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `computedAt` | `string (date-time)` | yes |  |
| `freshness` | `number` | yes |  |
| `readiness` | `number` | yes |  |
| `strain` | `number` | yes |  |

### ScoreRange

Type: `string`

One of `7d`, `30d`, `90d`.

### ScoreSuggestion

One deterministic rule-based recommendation.

Required: `key`, `title`, `description`, `action`, `actionLabel`, `priority`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `key` | `string` | yes |  |
| `title` | `string` | yes |  |
| `description` | `string` | yes |  |
| `action` | `string` | yes |  |
| `actionLabel` | `string` | yes |  |
| `priority` | `string` | yes | One of `high`, `medium`, `low`. |

### ScoreSuggestions

Rule-based suggestions derived from one score snapshot.

Required: `generatedBy`, `basedOn`, `items`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `generatedBy` | `string` | yes | Must be `rules`. |
| `basedOn` | `string (date-time)` | yes |  |
| `items` | `ScoreSuggestion[]` | yes |  |

### SearchHit

Required: `pageId`, `slug`, `title`, `summary`, `similarity`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `pageId` | `string` | yes |  |
| `slug` | `string` | yes |  |
| `title` | `string` | yes |  |
| `summary` | `string` | yes |  |
| `pageType` | [`PageType`](#pagetype) | no |  |
| `similarity` | `number \| null` | yes | Vector score only. Keyword-only matches carry `null`. |
| `updatedAt` | `string (date-time)` | no |  |

### SourceContentUrl

A short-lived signed URL for the stored body of an ingest source.

Required: `url`, `expiresAt`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | `string \| null` | yes |  |
| `expiresAt` | `string (date-time) \| null` | yes |  |

### SourceStatus

Type: `string`

One of `pending`, `compiling`, `completed`, `failed`.

### TargetType

Type: `string`

One of `brain`, `source`, `page`.

### Tenant

Required: `id`, `name`, `slug`, `plan`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string (uuid)` | yes |  |
| `name` | `string` | yes |  |
| `slug` | `string` | yes |  |
| `plan` | `string` | yes |  |

### Webhook

Required: `id`, `subjectId`, `url`, `events`, `active`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string (uuid)` | yes |  |
| `subjectId` | `string (uuid)` | yes |  |
| `url` | `string (uri)` | yes |  |
| `events` | `string[]` | yes |  |
| `active` | `boolean` | yes |  |
| `secret` | `string` | no | The plaintext signing secret. Returned only by the create response and never shown again; list and delete responses omit it. |

### WebhookCreate

Required: `url`, `events`

| Property | Type | Required | Notes |
| --- | --- | --- | --- |
| `url` | `string (uri)` | yes | An `http` or `https` URL with no embedded credentials, at most 2,048 characters. Maximum length 2048. |
| `events` | `string[]` | yes | One to twenty distinct change actions. At least 1 item. |

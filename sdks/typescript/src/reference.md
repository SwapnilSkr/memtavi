# Reference
## Brains
<details><summary><code>client.brains.<a href="/src/api/resources/brains/client/Client.ts">listBrains</a>({ ...params }) -> MemtaviApi.ListBrainsResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Lists the brains visible to the subject in `x-subject-id`.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.brains.listBrains();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ListBrainsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BrainsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.brains.<a href="/src/api/resources/brains/client/Client.ts">createBrain</a>({ ...params }) -> MemtaviApi.Brain</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Creates a brain for the subject in `x-subject-id`. Requires developer or higher.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.brains.createBrain({
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.BrainCreate` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BrainsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.brains.<a href="/src/api/resources/brains/client/Client.ts">getBrain</a>({ ...params }) -> MemtaviApi.Brain</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.brains.getBrain({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.GetBrainRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BrainsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.brains.<a href="/src/api/resources/brains/client/Client.ts">deleteBrain</a>({ ...params }) -> MemtaviApi.DeletionReceipt</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Accepts an asynchronous deletion of the brain and everything under it.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.brains.deleteBrain({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.DeleteBrainRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BrainsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.brains.<a href="/src/api/resources/brains/client/Client.ts">updateBrain</a>({ ...params }) -> MemtaviApi.Brain</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.brains.updateBrain({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.BrainUpdate` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `BrainsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Captures
<details><summary><code>client.captures.<a href="/src/api/resources/captures/client/Client.ts">createCapture</a>({ ...params }) -> MemtaviApi.IngestSource</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Submits one capture for compilation. Supply exactly one of `content` or `fetchUrl`;
supplying both returns `400`. The capture is queued, not compiled in the request.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.captures.createCapture({
    brainId: "brainId",
    kind: "note"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.Capture` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `CapturesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Sources
<details><summary><code>client.sources.<a href="/src/api/resources/sources/client/Client.ts">listIngestSources</a>({ ...params }) -> MemtaviApi.ListIngestSourcesResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sources.listIngestSources({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ListIngestSourcesRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SourcesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sources.<a href="/src/api/resources/sources/client/Client.ts">getIngestSource</a>({ ...params }) -> MemtaviApi.IngestSource</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sources.getIngestSource({
    brainId: "brainId",
    sourceId: "sourceId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.GetIngestSourceRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SourcesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sources.<a href="/src/api/resources/sources/client/Client.ts">deleteIngestSource</a>({ ...params }) -> MemtaviApi.DeletionReceipt</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Deletes the source. Pages derived from it stay in place.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sources.deleteIngestSource({
    brainId: "brainId",
    sourceId: "sourceId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.DeleteIngestSourceRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SourcesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sources.<a href="/src/api/resources/sources/client/Client.ts">getSourceContent</a>({ ...params }) -> MemtaviApi.SourceContentUrl</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns a signed URL that expires after 300 seconds. `url` and `expiresAt` are
`null` when the configured object store cannot sign. A source without a stored
body returns `404`.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sources.getSourceContent({
    brainId: "brainId",
    sourceId: "sourceId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.GetSourceContentRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SourcesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sources.<a href="/src/api/resources/sources/client/Client.ts">retryIngestSource</a>({ ...params }) -> MemtaviApi.IngestSource</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Queues another attempt for a source whose status is `failed`, keeping the same source id.
The status returns to `pending` and `lastError` is cleared. `attempts` counts accepted
retries and is never reset. When the stored body or chunks exist the source is recompiled;
otherwise the original fetch is repeated. Storage usage is not counted again. Requires
developer or higher.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.sources.retryIngestSource({
    brainId: "brainId",
    sourceId: "sourceId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.RetryIngestSourceRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SourcesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Pages
<details><summary><code>client.pages.<a href="/src/api/resources/pages/client/Client.ts">listPages</a>({ ...params }) -> MemtaviApi.ListPagesResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Lists pages without bumping `lastReferencedAt`.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pages.listPages({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ListPagesRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PagesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pages.<a href="/src/api/resources/pages/client/Client.ts">getPage</a>({ ...params }) -> MemtaviApi.Page</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Reads the page and bumps `lastReferencedAt`. It is a consumption signal, not a
list hydrator, so list endpoints do not bump it.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pages.getPage({
    brainId: "brainId",
    slug: "slug"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.GetPageRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PagesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pages.<a href="/src/api/resources/pages/client/Client.ts">deletePage</a>({ ...params }) -> MemtaviApi.DeletionReceipt</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Permanently deletes the page. `permanent=true` is a required confirmation, not a
soft-delete flag.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pages.deletePage({
    brainId: "brainId",
    slug: "slug",
    permanent: true
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.DeletePageRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PagesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pages.<a href="/src/api/resources/pages/client/Client.ts">updatePage</a>({ ...params }) -> MemtaviApi.Page</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Applies a user edit and records a new page version. Sending a `version` that is not
the current version returns `409`.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.pages.updatePage({
    brainId: "brainId",
    slug: "slug"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.PageUpdate` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `PagesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Search
<details><summary><code>client.search.<a href="/src/api/resources/search/client/Client.ts">brain</a>({ ...params }) -> MemtaviApi.SearchBrainResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Keyword matches bypass `minSimilarity`; semantic-only matches do not. `similarity`
carries the vector score only, so results can appear out of similarity order.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.search.brain({
    brainId: "brainId",
    q: "q"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.SearchBrainRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SearchClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.search.<a href="/src/api/resources/search/client/Client.ts">getIndex</a>({ ...params }) -> MemtaviApi.GetIndexResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the compact index of pages in the brain.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.search.getIndex({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.GetIndexRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SearchClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.search.<a href="/src/api/resources/search/client/Client.ts">getGraph</a>({ ...params }) -> MemtaviApi.Graph</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the page nodes and connection edges of the brain.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.search.getGraph({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.GetGraphRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `SearchClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Connections
<details><summary><code>client.connections.<a href="/src/api/resources/connections/client/Client.ts">listConnections</a>({ ...params }) -> MemtaviApi.ListConnectionsResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.connections.listConnections({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ListConnectionsRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConnectionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.connections.<a href="/src/api/resources/connections/client/Client.ts">ackConnection</a>({ ...params }) -> MemtaviApi.Connection</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Marks the connection as seen. Acknowledging is idempotent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.connections.ackConnection({
    brainId: "brainId",
    connectionId: "connectionId",
    body: {
        acked: true
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.AckConnectionRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ConnectionsClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Changes
<details><summary><code>client.changes.<a href="/src/api/resources/changes/client/Client.ts">listChanges</a>({ ...params }) -> MemtaviApi.ListChangesResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.changes.listChanges({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ListChangesRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChangesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.changes.<a href="/src/api/resources/changes/client/Client.ts">ackChange</a>({ ...params }) -> MemtaviApi.ChangeEvent</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Marks the change event as seen. Acknowledging is idempotent.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.changes.ackChange({
    brainId: "brainId",
    changeId: "changeId",
    body: {
        acked: true
    }
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.AckChangeRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ChangesClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Score
<details><summary><code>client.score.<a href="/src/api/resources/score/client/Client.ts">getScore</a>({ ...params }) -> MemtaviApi.Score</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the latest score snapshot for the brain.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.score.getScore({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.GetScoreRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ScoreClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Profile
<details><summary><code>client.profile.<a href="/src/api/resources/profile/client/Client.ts">getProfile</a>({ ...params }) -> MemtaviApi.Profile</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.profile.getProfile({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.GetProfileRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProfileClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.profile.<a href="/src/api/resources/profile/client/Client.ts">updateProfile</a>({ ...params }) -> MemtaviApi.Profile</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.profile.updateProfile({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ProfileUpdate` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ProfileClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Export
<details><summary><code>client.export.<a href="/src/api/resources/export/client/Client.ts">brain</a>({ ...params }) -> MemtaviApi.ExportBrainResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Returns the brain and its pages, versions, sources and connections.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.export.brain({
    brainId: "brainId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ExportBrainRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ExportClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Webhooks
<details><summary><code>client.webhooks.<a href="/src/api/resources/webhooks/client/Client.ts">listWebhooks</a>({ ...params }) -> MemtaviApi.ListWebhooksResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Lists webhooks registered for the subject in `x-subject-id`.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.webhooks.listWebhooks();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ListWebhooksRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WebhooksClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.webhooks.<a href="/src/api/resources/webhooks/client/Client.ts">createWebhook</a>({ ...params }) -> MemtaviApi.Webhook</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Registers a webhook for the subject in `x-subject-id` and returns its signing secret exactly once.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.webhooks.createWebhook({
    url: "url",
    events: ["created"]
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.WebhookCreate` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WebhooksClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.webhooks.<a href="/src/api/resources/webhooks/client/Client.ts">deleteWebhook</a>({ ...params }) -> void</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.webhooks.deleteWebhook({
    webhookId: "webhookId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.DeleteWebhookRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `WebhooksClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Tenant
<details><summary><code>client.tenant.<a href="/src/api/resources/tenant/client/Client.ts">getTenant</a>() -> MemtaviApi.Tenant</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Requires owner.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.tenant.getTenant();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**requestOptions:** `TenantClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Members
<details><summary><code>client.members.<a href="/src/api/resources/members/client/Client.ts">listMembers</a>({ ...params }) -> MemtaviApi.ListMembersResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.members.listMembers();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ListMembersRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `MembersClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## API Keys
<details><summary><code>client.apiKeys.<a href="/src/api/resources/apiKeys/client/Client.ts">listApiKeys</a>({ ...params }) -> MemtaviApi.ListApiKeysResponse</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Requires admin or higher. Never returns plaintext keys or hashes.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.apiKeys.listApiKeys();

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ListApiKeysRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ApiKeysClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.apiKeys.<a href="/src/api/resources/apiKeys/client/Client.ts">createApiKey</a>({ ...params }) -> MemtaviApi.ApiKey</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Requires admin or higher. The role defaults to viewer and cannot exceed the caller's role. The plaintext key is returned once in the `key` field of this response.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.apiKeys.createApiKey({
    name: "name"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.ApiKeyCreate` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ApiKeysClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.apiKeys.<a href="/src/api/resources/apiKeys/client/Client.ts">deleteApiKey</a>({ ...params }) -> void</code></summary>
<dl>
<dd>

#### 📝 Description

<dl>
<dd>

<dl>
<dd>

Requires admin or higher. Revocation takes effect on the next request.
</dd>
</dl>
</dd>
</dl>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```typescript
await client.apiKeys.deleteApiKey({
    keyId: "keyId"
});

```
</dd>
</dl>
</dd>
</dl>

#### ⚙️ Parameters

<dl>
<dd>

<dl>
<dd>

**request:** `MemtaviApi.DeleteApiKeyRequest` 
    
</dd>
</dl>

<dl>
<dd>

**requestOptions:** `ApiKeysClient.RequestOptions` 
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>


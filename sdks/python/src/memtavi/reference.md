# Reference
## Brains
<details><summary><code>client.brains.<a href="src/memtavi/brains/client.py">list_brains</a>(...) -> ListBrainsResponse</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.brains.list_brains()

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

**limit:** `typing.Optional[int]` — Maximum number of items to return.
    
</dd>
</dl>

<dl>
<dd>

**offset:** `typing.Optional[int]` — Number of items to skip before collecting the page.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.brains.<a href="src/memtavi/brains/client.py">create_brain</a>(...) -> Brain</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.brains.create_brain(
    name="name",
)

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

**name:** `str` 
    
</dd>
</dl>

<dl>
<dd>

**slug:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**description:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**project_id:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**brief_settings:** `typing.Optional[typing.Dict[str, typing.Any]]` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.brains.<a href="src/memtavi/brains/client.py">get_brain</a>(...) -> Brain</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.brains.get_brain(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.brains.<a href="src/memtavi/brains/client.py">delete_brain</a>(...) -> DeletionReceipt</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.brains.delete_brain(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.brains.<a href="src/memtavi/brains/client.py">update_brain</a>(...) -> Brain</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.brains.update_brain(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**name:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**description:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**project_id:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**brief_settings:** `typing.Optional[typing.Dict[str, typing.Any]]` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Captures
<details><summary><code>client.captures.<a href="src/memtavi/captures/client.py">create_capture</a>(...) -> IngestSource</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.captures.create_capture(
    brain_id="brainId",
    kind="note",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**kind:** `CaptureKind` 
    
</dd>
</dl>

<dl>
<dd>

**idempotency_key:** `typing.Optional[str]` 

Client-generated key. A replay within 24 hours returns the original response
byte-for-byte.
    
</dd>
</dl>

<dl>
<dd>

**content:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**fetch_url:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**origin_ref:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**label:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**bucket:** `typing.Optional[Bucket]` 
    
</dd>
</dl>

<dl>
<dd>

**metadata:** `typing.Optional[typing.Dict[str, typing.Any]]` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Sources
<details><summary><code>client.sources.<a href="src/memtavi/sources/client.py">list_ingest_sources</a>(...) -> ListIngestSourcesResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.sources.list_ingest_sources(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Maximum number of items to return.
    
</dd>
</dl>

<dl>
<dd>

**offset:** `typing.Optional[int]` — Number of items to skip before collecting the page.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sources.<a href="src/memtavi/sources/client.py">get_ingest_source</a>(...) -> IngestSource</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.sources.get_ingest_source(
    brain_id="brainId",
    source_id="sourceId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**source_id:** `str` — Prefixed ingest source id, `src_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sources.<a href="src/memtavi/sources/client.py">delete_ingest_source</a>(...) -> DeletionReceipt</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.sources.delete_ingest_source(
    brain_id="brainId",
    source_id="sourceId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**source_id:** `str` — Prefixed ingest source id, `src_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sources.<a href="src/memtavi/sources/client.py">get_source_content</a>(...) -> SourceContentUrl</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.sources.get_source_content(
    brain_id="brainId",
    source_id="sourceId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**source_id:** `str` — Prefixed ingest source id, `src_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.sources.<a href="src/memtavi/sources/client.py">retry_ingest_source</a>(...) -> IngestSource</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.sources.retry_ingest_source(
    brain_id="brainId",
    source_id="sourceId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**source_id:** `str` — Prefixed ingest source id, `src_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Pages
<details><summary><code>client.pages.<a href="src/memtavi/pages/client.py">list_pages</a>(...) -> ListPagesResponse</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.pages.list_pages(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Maximum number of items to return.
    
</dd>
</dl>

<dl>
<dd>

**offset:** `typing.Optional[int]` — Number of items to skip before collecting the page.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pages.<a href="src/memtavi/pages/client.py">get_page</a>(...) -> Page</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.pages.get_page(
    brain_id="brainId",
    slug="slug",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**slug:** `str` — The page slug within the brain.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pages.<a href="src/memtavi/pages/client.py">delete_page</a>(...) -> DeletionReceipt</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.pages.delete_page(
    brain_id="brainId",
    slug="slug",
    permanent=True,
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**slug:** `str` — The page slug within the brain.
    
</dd>
</dl>

<dl>
<dd>

**permanent:** `bool` — Confirmation that the page is deleted permanently. Must be `true`.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.pages.<a href="src/memtavi/pages/client.py">update_page</a>(...) -> Page</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.pages.update_page(
    brain_id="brainId",
    slug="slug",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**slug:** `str` — The page slug within the brain.
    
</dd>
</dl>

<dl>
<dd>

**title:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**summary:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**body:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**bucket:** `typing.Optional[Bucket]` 
    
</dd>
</dl>

<dl>
<dd>

**pinned:** `typing.Optional[bool]` 
    
</dd>
</dl>

<dl>
<dd>

**archived:** `typing.Optional[bool]` 
    
</dd>
</dl>

<dl>
<dd>

**status:** `typing.Optional[PageStatus]` 
    
</dd>
</dl>

<dl>
<dd>

**version:** `typing.Optional[int]` — The version the client last read. A mismatch returns `409`.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Search
<details><summary><code>client.search.<a href="src/memtavi/search/client.py">brain</a>(...) -> SearchBrainResponse</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.search.brain(
    brain_id="brainId",
    q="q",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**q:** `str` — The search phrase.
    
</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Maximum number of search hits to return.
    
</dd>
</dl>

<dl>
<dd>

**min_similarity:** `typing.Optional[float]` — Lowest vector similarity to return for semantic-only matches.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.search.<a href="src/memtavi/search/client.py">get_index</a>(...) -> GetIndexResponse</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.search.get_index(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Maximum number of index entries to return.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.search.<a href="src/memtavi/search/client.py">get_graph</a>(...) -> Graph</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.search.get_graph(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Connections
<details><summary><code>client.connections.<a href="src/memtavi/connections/client.py">list_connections</a>(...) -> ListConnectionsResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.connections.list_connections(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Maximum number of items to return.
    
</dd>
</dl>

<dl>
<dd>

**offset:** `typing.Optional[int]` — Number of items to skip before collecting the page.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.connections.<a href="src/memtavi/connections/client.py">ack_connection</a>(...) -> Connection</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.connections.ack_connection(
    brain_id="brainId",
    connection_id="connectionId",
    acked=True,
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**connection_id:** `str` — Prefixed connection id, `cnn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request:** `AckRequest` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Changes
<details><summary><code>client.changes.<a href="src/memtavi/changes/client.py">list_changes</a>(...) -> ListChangesResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.changes.list_changes(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**limit:** `typing.Optional[int]` — Maximum number of items to return.
    
</dd>
</dl>

<dl>
<dd>

**offset:** `typing.Optional[int]` — Number of items to skip before collecting the page.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.changes.<a href="src/memtavi/changes/client.py">ack_change</a>(...) -> ChangeEvent</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.changes.ack_change(
    brain_id="brainId",
    change_id="changeId",
    acked=True,
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**change_id:** `str` — Prefixed change event id, `chg_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request:** `AckRequest` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Score
<details><summary><code>client.score.<a href="src/memtavi/score/client.py">get_score</a>(...) -> Score</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.score.get_score(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Profile
<details><summary><code>client.profile.<a href="src/memtavi/profile/client.py">get_profile</a>(...) -> Profile</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.profile.get_profile(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.profile.<a href="src/memtavi/profile/client.py">update_profile</a>(...) -> Profile</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.profile.update_profile(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**who_they_are:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**what_they_do:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**focus:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**goals:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**current_projects:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**stuck_on:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**vault_organization:** `typing.Optional[str]` 
    
</dd>
</dl>

<dl>
<dd>

**directives:** `typing.Optional[typing.Dict[str, typing.Any]]` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Export
<details><summary><code>client.export.<a href="src/memtavi/export/client.py">brain</a>(...) -> ExportBrainResponse</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.export.brain(
    brain_id="brainId",
)

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

**brain_id:** `str` — Prefixed brain id, `brn_` followed by 32 lowercase hex characters.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Webhooks
<details><summary><code>client.webhooks.<a href="src/memtavi/webhooks/client.py">list_webhooks</a>(...) -> ListWebhooksResponse</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.webhooks.list_webhooks()

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

**limit:** `typing.Optional[int]` — Maximum number of items to return.
    
</dd>
</dl>

<dl>
<dd>

**offset:** `typing.Optional[int]` — Number of items to skip before collecting the page.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.webhooks.<a href="src/memtavi/webhooks/client.py">create_webhook</a>(...) -> Webhook</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.webhooks.create_webhook(
    url="url",
    events=[
        "created"
    ],
)

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

**url:** `str` — An `http` or `https` URL with no embedded credentials, at most 2,048 characters.
    
</dd>
</dl>

<dl>
<dd>

**events:** `typing.List[WebhookCreateEventsItem]` — One to twenty distinct change actions.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.webhooks.<a href="src/memtavi/webhooks/client.py">delete_webhook</a>(...)</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.webhooks.delete_webhook(
    webhook_id="webhookId",
)

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

**webhook_id:** `str` — Webhook UUID.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Tenant
<details><summary><code>client.tenant.<a href="src/memtavi/tenant/client.py">get_tenant</a>() -> Tenant</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.tenant.get_tenant()

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

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## Members
<details><summary><code>client.members.<a href="src/memtavi/members/client.py">list_members</a>(...) -> ListMembersResponse</code></summary>
<dl>
<dd>

#### 🔌 Usage

<dl>
<dd>

<dl>
<dd>

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.members.list_members()

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

**limit:** `typing.Optional[int]` — Maximum number of items to return.
    
</dd>
</dl>

<dl>
<dd>

**offset:** `typing.Optional[int]` — Number of items to skip before collecting the page.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

## API Keys
<details><summary><code>client.api_keys.<a href="src/memtavi/api_keys/client.py">list_api_keys</a>(...) -> ListApiKeysResponse</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.api_keys.list_api_keys()

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

**limit:** `typing.Optional[int]` — Maximum number of items to return.
    
</dd>
</dl>

<dl>
<dd>

**offset:** `typing.Optional[int]` — Number of items to skip before collecting the page.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.api_keys.<a href="src/memtavi/api_keys/client.py">create_api_key</a>(...) -> ApiKey</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.api_keys.create_api_key(
    name="name",
)

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

**name:** `str` 
    
</dd>
</dl>

<dl>
<dd>

**role:** `typing.Optional[MemberRole]` 
    
</dd>
</dl>

<dl>
<dd>

**scopes:** `typing.Optional[typing.List[str]]` 
    
</dd>
</dl>

<dl>
<dd>

**expires_at:** `typing.Optional[datetime.datetime]` 
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>

<details><summary><code>client.api_keys.<a href="src/memtavi/api_keys/client.py">delete_api_key</a>(...)</code></summary>
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

```python
from memtavi import MemtaviApi
from memtavi.environment import MemtaviApiEnvironment

client = MemtaviApi(
    api_key="<value>",
    subject_id="<x-subject-id>",
    environment=MemtaviApiEnvironment.DEFAULT,
)

client.api_keys.delete_api_key(
    key_id="keyId",
)

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

**key_id:** `str` — API key UUID.
    
</dd>
</dl>

<dl>
<dd>

**request_options:** `typing.Optional[RequestOptions]` — Request-specific configuration.
    
</dd>
</dl>
</dd>
</dl>


</dd>
</dl>
</details>


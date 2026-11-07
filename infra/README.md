# Media storage

Private S3 for source bodies, chunk text, original uploads and exports, served through CloudFront with OAC and signed URLs.

## Deployed dev stack

| Output | Value |
|---|---|
| Media bucket | `memtavi-media-dev-209479287671` |
| Logs bucket | `memtavi-logs-dev-209479287671` |
| Distribution | `E22V6MKMFVBZ8C` |
| Domain | `d2dmc3wnvzsf1d.cloudfront.net` |
| Signing key pair id | `K31OG46DC5R5Y8` |
| Private key | SSM SecureString `/memtavi/dev/cloudfront-private-key` |
| Worker policy | `arn:aws:iam::209479287671:policy/memtavi-storage-worker-dev` |
| API policy | `arn:aws:iam::209479287671:policy/memtavi-storage-api-dev` |

Region: `ap-south-1`. Stack: `memtavi-storage-dev`.

## Key layout

```
sources/<tenantId>/<sourceId>/<sha256>.txt
chunks/<tenantId>/<sourceId>/<sha256>/<ordinal>.txt
originals/<tenantId>/<sourceId>/<sha256>.<ext>
exports/<tenantId>/<brainId>/<jobId>.zip
```

Keys are content-addressed and immutable, so a changed body is a new object and cache TTLs can be long.

## Security properties

- All four Block Public Access settings on; object ownership enforced; no ACLs.
- SSE-S3 on every object; the bucket policy denies non-TLS requests.
- CloudFront reaches the bucket only through OAC, and the bucket policy scopes `s3:GetObject` to this distribution's ARN.
- Every viewer request must be a signed URL. An unsigned request returns `403`.
- The CloudFront private key lives in SSM SecureString and in `infra/.keys/<env>/` (gitignored). It is never committed.
- IAM: `memtavi-storage-worker-dev` can put/get/delete under `sources/`, `chunks/`, `originals/`; `memtavi-storage-api-dev` can get those and put under `exports/`. No wildcard `s3:*`, no bucket-wide list.

## Lifecycle

- `exports/` expires after 7 days.
- `originals/` moves to Glacier Instant Retrieval after 90 days, expires after 365.
- Noncurrent versions expire after 30 days.
- Incomplete multipart uploads abort after 7 days.

S3 server access logs go to the logs bucket and expire after 30 days. CloudFront standard logging is **not** enabled: the v1 delivery path requires ACLs on the log bucket, and this bucket intentionally disables ACLs. CloudWatch metrics cover 4xx/5xx meanwhile. If request-level logs become necessary, use CloudFront standard logging v2 to CloudWatch Logs rather than re-enabling ACLs.

## TLS and a custom domain

With the default `*.cloudfront.net` certificate CloudFront forces a **TLSv1 minimum**; it ignores a higher `MinimumProtocolVersion`. To get TLS 1.2+ and a branded hostname, pass both extra parameters (the certificate must be in `us-east-1`):

```bash
aws cloudformation deploy \
  --stack-name memtavi-storage-dev \
  --template-file infra/storage.yaml \
  --parameter-overrides Env=dev AccountId=209479287671 \
    PublicKeyPem="$(cat infra/.keys/dev/public.pem)" \
    CertificateArn=arn:aws:acm:us-east-1:209479287671:certificate/... \
    AliasDomain=media.memtavi.com \
  --capabilities CAPABILITY_NAMED_IAM
```

When `CertificateArn` is set, the distribution switches to `sni-only` with `TLSv1.2_2021` and adds the alias.

## Operations

```bash
# deploy or update (generates the key pair only if absent)
MEMTAVI_AWS_ACCOUNT=209479287671 bash infra/deploy.sh dev

# verify privacy
aws s3api get-public-access-block --bucket memtavi-media-dev-209479287671

# sign a URL for 10 minutes
aws cloudfront sign \
  --url "https://d2dmc3wnvzsf1d.cloudfront.net/sources/<tenant>/<source>/<sha>.txt" \
  --key-pair-id K31OG46DC5R5Y8 \
  --private-key "file://infra/.keys/dev/private.pem" \
  --date-less-than "$(python3 -c 'import datetime;print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ"))')"

# tear down (buckets are retained on purpose)
aws cloudformation delete-stack --stack-name memtavi-storage-dev --region ap-south-1
aws s3 rb s3://memtavi-media-dev-209479287671 --force
aws s3 rb s3://memtavi-logs-dev-209479287671 --force
```

## Cost

One bucket pair, one distribution at `PriceClass_200` (US, Canada, Europe, Asia, Middle East, Africa — the right class for a Mumbai origin and Indian users), no KMS, no WAF, no Shield Advanced. At dev volume this is cents per month; the only real variable is CloudFront egress.

## Known gaps

| Gap | Why it matters | Fix |
|---|---|---|
| TLS minimum is `TLSv1` | Default CloudFront certificate ignores a higher minimum | Set `CertificateArn` + `AliasDomain`; needs a domain and an ACM cert in `us-east-1` |
| No CloudFront request logs | Only S3 access logs and CloudWatch metrics today | CloudFront standard logging v2 to CloudWatch Logs; do not re-enable ACLs |
| `sources/` and `chunks/` never expire | Storage grows with every capture | Citation-aware `storage-retention` job; never a blind lifecycle rule |
| No budget alarm | A runaway would only appear on the invoice | AWS Budget at $5/month with email |
| Dev CORS allows only `https://app.memtavi.com` | Browser fetches of signed URLs from `localhost:5173` will be blocked | Add the dev origin to `AllowedOrigin` |
| Uploads set no `Cache-Control` | CloudFront caches by default, but a shorter TTL than necessary | Set `public, max-age=31536000, immutable` in `packages/storage` |
| Local CLI is the root account | Root must never back an application process | Attach the two managed policies to ECS/EC2 task roles |

## App integration

`packages/storage` owns the SDK. Other packages call the `ObjectStore` interface only. Local development uses the filesystem driver; the S3 driver is used when `STORAGE_DRIVER=s3`.

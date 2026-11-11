import httpx
import pytest

from memtavi import MemtaviApi, NotFoundError
from memtavi.core.api_error import ApiError

API_KEY = "test-key"
SUBJECT_ID = "3f2f6f1a-9d4b-4c1e-8f5a-2b7c9d0e1f23"
BASE_URL = "https://api.test"
BRAIN_ID = "brn_0123456789abcdef0123456789abcdef"


def error_envelope(status_code, error):
    return {
        "statusCode": status_code,
        "timestamp": "2026-11-06T10:00:00.000Z",
        "path": "/v1/brains",
        "message": "Not found",
        "body": {"message": "Not found", "error": error, "statusCode": status_code},
    }


def build_client(handler):
    return MemtaviApi(
        api_key=API_KEY,
        subject_id=SUBJECT_ID,
        base_url=BASE_URL,
        httpx_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def test_list_brains_sends_get_with_both_auth_headers():
    captured = []

    def handler(request):
        captured.append(
            {
                "method": request.method,
                "path": request.url.path,
                "api_key": request.headers.get("x-api-key"),
                "subject_id": request.headers.get("x-subject-id"),
            }
        )
        return httpx.Response(200, json={"items": [], "total": 0, "limit": 50, "offset": 0})

    page = build_client(handler).brains.list_brains()

    assert page.total == 0
    assert captured == [
        {
            "method": "GET",
            "path": "/v1/brains",
            "api_key": API_KEY,
            "subject_id": SUBJECT_ID,
        }
    ]


def test_a_404_the_operation_does_not_declare_surfaces_as_api_error():
    client = build_client(lambda request: httpx.Response(404, json=error_envelope(404, "NotFoundError")))

    with pytest.raises(ApiError) as caught:
        client.brains.list_brains()

    assert caught.value.status_code == 404


def test_a_declared_404_envelope_surfaces_as_not_found_error():
    client = build_client(lambda request: httpx.Response(404, json=error_envelope(404, "NotFoundError")))

    with pytest.raises(NotFoundError) as caught:
        client.brains.get_brain(BRAIN_ID)

    assert caught.value.body.body.error == "NotFoundError"


def test_review_operations_serialize_filters_choices_and_dismissal():
    import json
    from memtavi import RoutingReviewResolveNewPage, RoutingReviewResolvePageId

    review_id = "11111111-1111-4111-8111-111111111111"
    page_id = "pg_" + "1" * 32
    base_path = f"/v1/brains/{BRAIN_ID}/routing-reviews"
    captured = []
    review = {
        "id": review_id, "sourceId": "src_" + "1" * 32,
        "fact": {"claim": "Friday", "entities": [], "evidence": {
            "chunkUuid": review_id, "charStart": 0, "charEnd": 6, "quote": "Friday"}},
        "candidates": [], "bestGap": 0, "status": "resolved", "resolution": None,
        "createdAt": "2026-11-11T00:00:00.000Z",
    }

    def handler(request):
        assert request.headers["x-api-key"] == API_KEY
        assert request.headers["x-subject-id"] == SUBJECT_ID
        captured.append((request.method, request.url.path, dict(request.url.params),
                         json.loads(request.content) if request.content else None))
        if request.method == "GET":
            return httpx.Response(200, json={"items": [review], "total": 1, "limit": 5, "offset": 2})
        return httpx.Response(202 if request.url.path.endswith("resolve") else 200, json=review)

    client = build_client(handler)
    assert client.reviews.list_routing_reviews(BRAIN_ID, status="resolved", limit=5, offset=2).total == 1
    client.reviews.resolve_routing_review(BRAIN_ID, review_id,
        request=RoutingReviewResolvePageId(page_id=page_id, note="Chosen"))
    client.reviews.resolve_routing_review(BRAIN_ID, review_id,
        request=RoutingReviewResolveNewPage(new_page=True))
    client.reviews.dismiss_routing_review(BRAIN_ID, review_id, note="Source only")
    assert captured == [
        ("GET", base_path, {"limit": "5", "offset": "2", "status": "resolved"}, None),
        ("POST", f"{base_path}/{review_id}/resolve", {}, {"pageId": page_id, "note": "Chosen"}),
        ("POST", f"{base_path}/{review_id}/resolve", {}, {"newPage": True}),
        ("POST", f"{base_path}/{review_id}/dismiss", {}, {"note": "Source only"}),
    ]

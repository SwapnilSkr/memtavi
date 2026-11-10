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

from datetime import date


def test_create_list_patch_delete(client):
    res = client.post("/api/spendings", json={"amount_cents": 450, "note": "Coffee", "tag": "cafe", "spent_on": "2026-10-05"})
    assert res.status_code == 201
    s = res.json()
    assert s["amount_cents"] == 450 and s["note"] == "Coffee" and s["tag"] == "cafe"
    assert s["spent_on"] == "2026-10-05"

    items = client.get("/api/spendings").json()
    assert len(items) == 1 and items[0]["id"] == s["id"]

    patched = client.patch(f"/api/spendings/{s['id']}", json={"note": "Latte", "amount_cents": 500}).json()
    assert patched["note"] == "Latte" and patched["amount_cents"] == 500

    assert client.delete(f"/api/spendings/{s['id']}").status_code == 204
    assert client.get("/api/spendings").json() == []
    assert client.patch(f"/api/spendings/{s['id']}", json={"amount_cents": 1}).status_code == 404


def test_range_filtering(client):
    client.post("/api/spendings", json={"amount_cents": 100, "spent_on": "2026-09-01"})
    client.post("/api/spendings", json={"amount_cents": 200, "spent_on": "2026-10-05"})
    client.post("/api/spendings", json={"amount_cents": 300, "spent_on": "2026-10-10"})

    in_range = client.get("/api/spendings", params={"start": "2026-10-01", "end": "2026-10-09"}).json()
    assert len(in_range) == 1 and in_range[0]["amount_cents"] == 200


def test_amount_validation(client):
    assert client.post("/api/spendings", json={"amount_cents": 0}).status_code == 422
    assert client.post("/api/spendings", json={"amount_cents": -1}).status_code == 422
    assert client.post("/api/spendings", json={"amount_cents": 10_000_001}).status_code == 422
    assert client.post("/api/spendings", json={"amount_cents": 1}).status_code == 201


def test_delete_returns_404(client):
    assert client.delete("/api/spendings/999").status_code == 404


def test_spent_on_defaults_to_today(client):
    res = client.post("/api/spendings", json={"amount_cents": 100})
    assert res.status_code == 201
    assert res.json()["spent_on"] == date.today().isoformat()


def test_export_import_includes_spendings(client):
    client.post("/api/spendings", json={"amount_cents": 1234, "note": "Test", "tag": "food", "spent_on": "2026-10-01"})

    export = client.get("/api/export").json()
    assert "spendings" in export["tables"]
    assert len(export["tables"]["spendings"]) == 1

    client.post("/api/spendings", json={"amount_cents": 999, "note": "Extra"})
    res = client.post("/api/import", json=export)
    assert res.status_code == 200
    assert res.json()["imported"]["spendings"] == 1

    after = client.get("/api/spendings").json()
    assert len(after) == 1 and after[0]["amount_cents"] == 1234 and after[0]["note"] == "Test"

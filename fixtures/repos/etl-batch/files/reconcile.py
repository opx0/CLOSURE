BATCH = 500


def run(source, sink):
    rows = source.fetch_all()
    for start in range(0, len(rows), BATCH):
        batch = rows[start : start + BATCH]
        try:
            sink.write_many(batch)
        except Exception as exc:
            print(f"batch {start} failed: {exc}")
    return 0

from scripts.repo_audit import build_backend_import_graph, detect_cycles


def test_backend_import_graph_has_no_cycles():
    graph = build_backend_import_graph()
    assert detect_cycles(graph) == []

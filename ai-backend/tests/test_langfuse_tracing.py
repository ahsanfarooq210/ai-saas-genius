import pytest

from app.agent.run import swarm_config
from app.core import langfuse


class _FakeObservation:
    def __init__(self) -> None:
        self.updates: list[dict] = []

    def update(self, **kwargs) -> None:
        self.updates.append(kwargs)


class _FakeObservationContext:
    def __init__(self, observation: _FakeObservation) -> None:
        self.observation = observation

    def __enter__(self) -> _FakeObservation:
        return self.observation

    def __exit__(self, exc_type, exc, traceback) -> bool:
        return False


class _FakeClient:
    def __init__(self, observation: _FakeObservation) -> None:
        self.observation = observation
        self.started_with: dict | None = None

    def start_as_current_observation(self, **kwargs) -> _FakeObservationContext:
        self.started_with = kwargs
        return _FakeObservationContext(self.observation)


class _FakePropagation:
    def __init__(self) -> None:
        self.called_with: dict | None = None

    def __call__(self, **kwargs):
        self.called_with = kwargs
        return _FakeObservationContext(_FakeObservation())


def _configure_langfuse(
    monkeypatch: pytest.MonkeyPatch,
    *,
    enabled: bool,
    public_key: str | None = None,
    secret_key: str | None = None,
) -> None:
    monkeypatch.setattr(langfuse.settings, "LANGFUSE_TRACING_ENABLED", enabled)
    monkeypatch.setattr(langfuse.settings, "LANGFUSE_PUBLIC_KEY", public_key)
    monkeypatch.setattr(langfuse.settings, "LANGFUSE_SECRET_KEY", secret_key)


def test_swarm_config_with_tracing_keeps_base_config_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_langfuse(monkeypatch, enabled=False)

    config = langfuse.swarm_config_with_tracing(
        swarm_config("thread-1"),
        "thread-1",
        "swarm.run",
    )

    assert config == swarm_config("thread-1")


def test_swarm_trace_disabled_does_not_suppress_application_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_langfuse(monkeypatch, enabled=False)

    with pytest.raises(RuntimeError, match="graph failed"):
        with langfuse.swarm_trace("swarm.run", "thread-1") as trace:
            trace.set_done()
            raise RuntimeError("graph failed")


def test_swarm_config_with_tracing_adds_callback_metadata_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    callback = object()
    _configure_langfuse(
        monkeypatch,
        enabled=True,
        public_key="pk-test",
        secret_key="sk-test",
    )
    monkeypatch.setattr(langfuse, "_new_callback_handler", lambda: callback)

    config = langfuse.swarm_config_with_tracing(
        swarm_config("thread-1"),
        "thread-1",
        "swarm.resume",
    )

    assert config["configurable"] == {"thread_id": "thread-1"}
    assert config["callbacks"] == [callback]
    assert config["run_name"] == "swarm.resume"
    assert "swarm-resume" in config["tags"]
    assert config["metadata"]["threadid"] == "thread-1"
    assert config["metadata"]["framework"] == "langgraph"


def test_swarm_trace_enabled_sets_root_input_session_and_summary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observation = _FakeObservation()
    client = _FakeClient(observation)
    propagation = _FakePropagation()
    _configure_langfuse(
        monkeypatch,
        enabled=True,
        public_key="pk-test",
        secret_key="sk-test",
    )
    monkeypatch.setattr(langfuse, "_get_langfuse_client", lambda: client)
    monkeypatch.setattr(langfuse, "_get_propagate_attributes", lambda: propagation)

    with langfuse.swarm_trace(
        "swarm.run",
        "thread-1",
        task_requirement="Design a URL shortener",
    ) as trace:
        trace.set_result(
            {
                "thread_id": "thread-1",
                "complexity_score": 4,
                "component_list": ["API", "DB"],
                "generated_diagrams": [{"diagram_type": "overview"}],
                "generated_docs": [{"title": "Overview"}],
                "docs_complete": True,
                "iteration_count": 2,
                "next_agent": "END",
            }
        )

    assert client.started_with is not None
    assert client.started_with["name"] == "swarm.run"
    assert client.started_with["input"]["task_requirement"] == "Design a URL shortener"
    assert propagation.called_with is not None
    assert propagation.called_with["session_id"] == "thread-1"
    assert "swarm-run" in propagation.called_with["tags"]
    assert observation.updates[-1]["output"] == {
        "status": "done",
        "thread_id": "thread-1",
        "complexity_score": 4,
        "component_count": 2,
        "diagram_count": 1,
        "doc_count": 1,
        "docs_complete": True,
        "iteration_count": 2,
        "next_agent": "END",
    }

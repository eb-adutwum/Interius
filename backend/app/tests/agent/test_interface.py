from app.agent.interface import InterfaceAgent, InterfaceContextMessage


def test_looks_like_thread_code_question_requires_prior_context():
    assert not InterfaceAgent.looks_like_thread_code_question(
        "Where is auth handled?",
        recent_messages=[],
    )


def test_looks_like_thread_code_question_detects_explanation_requests():
    recent_messages = [
        InterfaceContextMessage(role="agent", content="Interius generated a backend scaffold."),
    ]

    assert InterfaceAgent.looks_like_thread_code_question(
        "Where is auth handled in the generated code?",
        recent_messages=recent_messages,
    )
    assert InterfaceAgent.looks_like_thread_code_question(
        "Explain the users route file",
        recent_messages=recent_messages,
    )


def test_looks_like_thread_code_question_ignores_change_requests():
    recent_messages = [
        InterfaceContextMessage(role="assistant", content="Interius completed the build."),
    ]

    assert not InterfaceAgent.looks_like_thread_code_question(
        "Update the auth route to use JWT",
        recent_messages=recent_messages,
    )

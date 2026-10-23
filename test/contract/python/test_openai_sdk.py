"""SPEC-001, critério 2: o SDK `openai` de Python só troca base_url e api_key.

Roda dentro do teste Jest python-sdk.spec.ts, que sobe o gateway com roteamento roteirizado e
passa a URL em ANTHOLOGY_BASE_URL. A ordem dos testes é a ordem das respostas roteirizadas.
"""

import json
import os

import openai
import pytest

client = openai.OpenAI(
    base_url=os.environ["ANTHOLOGY_BASE_URL"] + "/v1", api_key="sk-test", max_retries=0
)
HELLO = [{"role": "user", "content": "oi"}]
TOOLS = [
    {
        "type": "function",
        "function": {"name": "clima", "parameters": {"type": "object", "properties": {}}},
    }
]


def test_1_lists_models_with_auto_first():
    ids = [m.id for m in client.models.list().data]
    assert ids == ["auto", "code", "general"]


def test_2_completes_without_stream():
    raw = client.chat.completions.with_raw_response.create(model="code", messages=HELLO)
    completion = raw.parse()
    assert completion.model == "code"
    assert completion.choices[0].message.content == "olá"
    assert completion.usage.total_tokens == 15
    assert raw.headers["x-anthology-model"] == "sonnet"


def test_3_tool_call_cycle():
    first = client.chat.completions.create(model="code", messages=HELLO, tools=TOOLS)
    message = first.choices[0].message
    assert first.choices[0].finish_reason == "tool_calls"
    assert message.content is None
    call = message.tool_calls[0]
    assert json.loads(call.function.arguments) == {"cidade": "Recife"}

    final = client.chat.completions.create(
        model="code",
        tools=TOOLS,
        messages=[
            *HELLO,
            message.model_dump(exclude_none=True),
            {"role": "tool", "tool_call_id": call.id, "content": "28"},
        ],
    )
    assert final.choices[0].message.content == "28 graus"


def test_4_n_2_is_unsupported_parameter():
    with pytest.raises(openai.BadRequestError) as info:
        client.chat.completions.create(model="code", messages=HELLO, n=2)
    assert info.value.code == "unsupported_parameter"
    assert info.value.param == "n"

import json

from inspect_ai.model import ChatMessageAssistant, ChatMessageUser, ModelOutput
from inspect_ai.solver import solver


def set_output(state, session):
    turns = session["turns"]
    state.output = ModelOutput.from_content(
        "campus-agent", (turns[-1].get("answer") or "") if turns else ""
    )
    state.messages = []
    for turn in turns:
        state.messages.append(ChatMessageUser(content=turn.get("user_prompt") or ""))
        if turn.get("answer"):
            state.messages.append(ChatMessageAssistant(content=turn["answer"]))
    state.completed = True
    return state


@solver
def saved_result():
    async def solve(state, generate):
        body = json.loads(state.input_text)
        state.store.set("case", body["case"])
        state.store.set("session", body["session"])
        return set_output(state, body["session"])

    return solve

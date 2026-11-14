---
name: learn
description: 학습을 시작하거나 지난번에서 이어간다.
argument-hint: "[모듈 id 또는 배우고 싶은 주제]"
disable-model-invocation: true
---

세션 흐름 규칙대로 학습을 시작하거나 이어간다. `learner/state.json`을 먼저 확인한다.

학습자가 지정한 것: $ARGUMENTS

지정이 모듈이면 「모듈 하나의 흐름」 0단계부터 시작한다. 주제면 가장 가까운 모듈에 대응시키고, 맞는 모듈이 없으면 선택 모듈(`E`)로 제안한다.

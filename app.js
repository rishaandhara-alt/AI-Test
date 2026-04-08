const API_URL = "https://api.cerebras.ai/v1/chat/completions";

const state = {
  config: null,
  quiz: [],
  currentIndex: 0,
  correctCount: 0,
  answeredCount: 0,
  activeResult: null,
  followupMessages: [],
  timerId: null,
  secondsLeft: 0,
};

const els = {
  setupCard: document.querySelector("#setup-card"),
  setupForm: document.querySelector("#setup-form"),
  quizCard: document.querySelector("#quiz-card"),
  summaryCard: document.querySelector("#summary-card"),
  topic: document.querySelector("#topic"),
  model: document.querySelector("#model"),
  questionCount: document.querySelector("#question-count"),
  difficulty: document.querySelector("#difficulty"),
  questionStyle: document.querySelector("#question-style"),
  timerEnabled: document.querySelector("#timer-enabled"),
  timerSeconds: document.querySelector("#timer-seconds"),
  showExplanations: document.querySelector("#show-explanations"),
  apiKey: document.querySelector("#api-key"),
  totalQuestionsStat: document.querySelector("#total-questions-stat"),
  doneStat: document.querySelector("#done-stat"),
  scoreStat: document.querySelector("#score-stat"),
  timerStatWrap: document.querySelector("#timer-stat-wrap"),
  timerStat: document.querySelector("#timer-stat"),
  questionHeading: document.querySelector("#question-heading"),
  questionMeta: document.querySelector("#question-meta"),
  questionPanel: document.querySelector("#question-panel"),
  answerForm: document.querySelector("#answer-form"),
  answerInput: document.querySelector("#answer-input"),
  submitAnswerBtn: document.querySelector("#submit-answer-btn"),
  nextQuestionBtn: document.querySelector("#next-question-btn"),
  resultPanel: document.querySelector("#result-panel"),
  followupPanel: document.querySelector("#followup-panel"),
  followupMessages: document.querySelector("#followup-messages"),
  followupForm: document.querySelector("#followup-form"),
  followupInput: document.querySelector("#followup-input"),
  summaryCopy: document.querySelector("#summary-copy"),
  summaryCorrect: document.querySelector("#summary-correct"),
  summaryTotal: document.querySelector("#summary-total"),
  summaryPercent: document.querySelector("#summary-percent"),
  restartBtn: document.querySelector("#restart-btn"),
};

els.setupForm.addEventListener("submit", handleGenerateQuiz);
els.answerForm.addEventListener("submit", handleSubmitAnswer);
els.nextQuestionBtn.addEventListener("click", handleNextQuestion);
els.followupForm.addEventListener("submit", handleFollowupQuestion);
els.restartBtn.addEventListener("click", restartQuiz);

function getConfigFromForm() {
  return {
    topic: els.topic.value.trim(),
    model: els.model.value,
    questionCount: Number(els.questionCount.value),
    difficulty: els.difficulty.value,
    questionStyle: els.questionStyle.value,
    timerEnabled: els.timerEnabled.checked,
    timerSeconds: Number(els.timerSeconds.value),
    showExplanations: els.showExplanations.checked,
    apiKey: els.apiKey.value.trim(),
  };
}

async function handleGenerateQuiz(event) {
  event.preventDefault();
  const config = getConfigFromForm();

  if (!config.topic || !config.apiKey) {
    window.alert("Please enter a topic and API key.");
    return;
  }

  setButtonBusy(els.setupForm.querySelector("button[type='submit']"), true, "Generating Quiz");

  try {
    const quiz = await generateQuiz(config);
    if (!Array.isArray(quiz) || quiz.length === 0) {
      throw new Error("The model did not return any questions.");
    }

    state.config = config;
    state.quiz = quiz;
    state.currentIndex = 0;
    state.correctCount = 0;
    state.answeredCount = 0;
    state.activeResult = null;
    state.followupMessages = [];

    els.setupCard.classList.add("hidden");
    els.summaryCard.classList.add("hidden");
    els.quizCard.classList.remove("hidden");

    renderStats();
    renderCurrentQuestion();
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Failed to generate the quiz.");
  } finally {
    setButtonBusy(els.setupForm.querySelector("button[type='submit']"), false, "Generate Quiz");
  }
}

async function generateQuiz(config) {
  const systemPrompt = [
    "You generate quiz content as strict JSON only.",
    "Return an object with a questions array.",
    "Each question object must include id, type, question, choices, correctAnswer, explanation.",
    'type must be "multiple_choice" or "short_answer".',
    "choices must be an array and empty for short answer.",
    "Do not wrap JSON in markdown.",
  ].join(" ");

  const userPrompt = [
    `Create exactly ${config.questionCount} quiz questions.`,
    `Topic: ${config.topic}.`,
    `Difficulty: ${config.difficulty}.`,
    `Question style preference: ${config.questionStyle}.`,
    config.showExplanations ? "Include a concise explanation for each correct answer." : "Keep explanations short.",
  ].join(" ");

  const content = await callModel({
    apiKey: config.apiKey,
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    responseFormat: { type: "json_object" },
  });

  const parsed = safeJsonParse(content);
  if (!Array.isArray(parsed.questions)) {
    throw new Error("Quiz JSON format was invalid.");
  }

  return parsed.questions.map((question, index) => ({
    id: String(question.id || index + 1),
    type:
      question.type === "multiple_choice" || question.type === "short_answer"
        ? question.type
        : Array.isArray(question.choices) && question.choices.length
          ? "multiple_choice"
          : "short_answer",
    question: String(question.question || "").trim(),
    choices: Array.isArray(question.choices) ? question.choices.map((choice) => String(choice)) : [],
    correctAnswer: String(question.correctAnswer || "").trim(),
    explanation: String(question.explanation || "").trim(),
  }));
}

function renderCurrentQuestion() {
  const current = state.quiz[state.currentIndex];
  state.activeResult = null;
  state.followupMessages = [];

  els.answerInput.value = "";
  els.answerInput.disabled = false;
  els.submitAnswerBtn.disabled = false;
  els.submitAnswerBtn.classList.remove("hidden");
  els.nextQuestionBtn.classList.add("hidden");
  els.resultPanel.className = "result-panel hidden";
  els.resultPanel.innerHTML = "";
  els.followupPanel.classList.add("hidden");
  renderFollowupMessages();

  els.questionHeading.textContent = `Question ${state.currentIndex + 1}`;
  els.questionMeta.textContent = current.type === "multiple_choice"
    ? "Answer the current question to see grading and the correct answer."
    : "Type your answer, then the AI will grade it.";

  const choicesMarkup =
    current.type === "multiple_choice" && current.choices.length
      ? `
        <div class="choice-list">
          ${current.choices.map((choice, idx) => `<div class="choice-item"><strong>${String.fromCharCode(65 + idx)}.</strong> ${escapeHtml(choice)}</div>`).join("")}
        </div>
      `
      : "";

  els.questionPanel.innerHTML = `
    <h3>${escapeHtml(current.question)}</h3>
    ${choicesMarkup}
  `;

  renderStats();
  startTimerIfNeeded();
}

function renderStats() {
  els.totalQuestionsStat.textContent = String(state.quiz.length);
  els.doneStat.textContent = String(state.answeredCount);
  els.scoreStat.textContent = `${state.correctCount} / ${state.answeredCount}`;
  if (state.config?.timerEnabled) {
    els.timerStatWrap.classList.remove("hidden");
    els.timerStat.textContent = `${state.secondsLeft || state.config.timerSeconds}s`;
  } else {
    els.timerStatWrap.classList.add("hidden");
  }
}

function startTimerIfNeeded() {
  clearTimer();
  if (!state.config?.timerEnabled) {
    return;
  }

  state.secondsLeft = state.config.timerSeconds;
  renderStats();

  state.timerId = window.setInterval(() => {
    state.secondsLeft -= 1;
    els.timerStat.textContent = `${Math.max(state.secondsLeft, 0)}s`;
    if (state.secondsLeft <= 0) {
      clearTimer();
      if (!state.activeResult) {
        gradeCurrentAnswer("(No answer submitted before the timer ended.)", true);
      }
    }
  }, 1000);
}

function clearTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

async function handleSubmitAnswer(event) {
  event.preventDefault();
  const answer = els.answerInput.value.trim();
  if (!answer) {
    window.alert("Please enter an answer.");
    return;
  }
  await gradeCurrentAnswer(answer, false);
}

async function gradeCurrentAnswer(answer, timedOut) {
  clearTimer();
  setButtonBusy(els.submitAnswerBtn, true, "Grading");

  try {
    const current = state.quiz[state.currentIndex];
    const result = await gradeAnswer(current, answer, timedOut);
    state.activeResult = result;
    state.answeredCount += 1;
    if (result.isCorrect) {
      state.correctCount += 1;
    }

    renderResult(answer, result, timedOut);
    renderStats();
    els.answerInput.disabled = true;
    els.submitAnswerBtn.classList.add("hidden");
    els.nextQuestionBtn.classList.remove("hidden");
    els.followupPanel.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Failed to grade the answer.");
  } finally {
    setButtonBusy(els.submitAnswerBtn, false, "Submit Answer");
  }
}

async function gradeAnswer(question, answer, timedOut) {
  const systemPrompt = [
    "You grade one quiz answer and return strict JSON only.",
    "Return keys: isCorrect, score, feedback, correctAnswer, explanation.",
    "Respect the official correct answer when grading.",
    "Do not wrap the response in markdown.",
  ].join(" ");

  const content = await callModel({
    apiKey: state.config.apiKey,
    model: state.config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify({ question, userAnswer: answer, timedOut }) },
    ],
    temperature: 0.2,
    responseFormat: { type: "json_object" },
  });

  const parsed = safeJsonParse(content);
  return {
    isCorrect: Boolean(parsed.isCorrect),
    score: Number(parsed.score ?? (parsed.isCorrect ? 1 : 0)),
    feedback: String(parsed.feedback || ""),
    correctAnswer: String(parsed.correctAnswer || question.correctAnswer),
    explanation: String(parsed.explanation || question.explanation || ""),
  };
}

function renderResult(userAnswer, result, timedOut) {
  const outcomeClass = result.isCorrect ? "correct" : "incorrect";
  els.resultPanel.className = `result-panel ${outcomeClass}`;
  els.resultPanel.innerHTML = `
    <div class="result-grid">
      <span class="result-chip ${outcomeClass}">${result.isCorrect ? "Correct" : "Incorrect"}</span>
      <div class="result-title">Grading result</div>
      ${timedOut ? "<div><strong>Timer:</strong> Time expired before submission.</div>" : ""}
      <div><strong>Your answer:</strong> ${escapeHtml(userAnswer)}</div>
      <div><strong>Correct answer:</strong> ${escapeHtml(result.correctAnswer)}</div>
      <div><strong>Feedback:</strong> ${escapeHtml(result.feedback)}</div>
      <div><strong>Explanation:</strong> ${escapeHtml(result.explanation)}</div>
    </div>
  `;
  els.resultPanel.classList.remove("hidden");
}

function handleNextQuestion() {
  if (state.currentIndex >= state.quiz.length - 1) {
    showSummary();
    return;
  }
  state.currentIndex += 1;
  renderCurrentQuestion();
}

function showSummary() {
  clearTimer();
  const percent = state.answeredCount ? Math.round((state.correctCount / state.answeredCount) * 100) : 0;
  els.quizCard.classList.add("hidden");
  els.summaryCard.classList.remove("hidden");
  els.summaryCorrect.textContent = String(state.correctCount);
  els.summaryTotal.textContent = String(state.answeredCount);
  els.summaryPercent.textContent = `${percent}%`;
  els.summaryCopy.textContent = `You answered ${state.correctCount} out of ${state.answeredCount} correctly.`;
}

function restartQuiz() {
  clearTimer();
  state.config = null;
  state.quiz = [];
  state.currentIndex = 0;
  state.correctCount = 0;
  state.answeredCount = 0;
  state.activeResult = null;
  state.followupMessages = [];
  els.summaryCard.classList.add("hidden");
  els.quizCard.classList.add("hidden");
  els.setupCard.classList.remove("hidden");
}

async function handleFollowupQuestion(event) {
  event.preventDefault();
  const prompt = els.followupInput.value.trim();
  if (!prompt || !state.activeResult) {
    return;
  }

  state.followupMessages.push({ role: "user", content: prompt });
  renderFollowupMessages();
  els.followupInput.value = "";
  setButtonBusy(els.followupForm.querySelector("button"), true, "Thinking");

  try {
    const current = state.quiz[state.currentIndex];
    const assistantText = await callModel({
      apiKey: state.config.apiKey,
      model: state.config.model,
      messages: [
        { role: "system", content: "You are helping a student understand one graded quiz question. Be concise, accurate, and helpful." },
        { role: "user", content: JSON.stringify({ question: current.question, choices: current.choices, officialCorrectAnswer: state.activeResult.correctAnswer, officialExplanation: state.activeResult.explanation, gradingFeedback: state.activeResult.feedback }) },
        ...state.followupMessages,
      ],
      temperature: 0.5,
    });

    state.followupMessages.push({ role: "assistant", content: assistantText });
    renderFollowupMessages();
  } catch (error) {
    console.error(error);
    window.alert(error.message || "Failed to send the follow-up question.");
  } finally {
    setButtonBusy(els.followupForm.querySelector("button"), false, "Ask AI");
  }
}

function renderFollowupMessages() {
  els.followupMessages.innerHTML = state.followupMessages
    .map((message) => `<div class="message ${message.role}"><strong>${message.role === "user" ? "You" : "AI"}:</strong> ${escapeHtml(message.content)}</div>`)
    .join("");
}

async function callModel({ apiKey, model, messages, temperature = 0.7, responseFormat }) {
  const payload = { model, messages, temperature };
  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("The API response did not contain message content.");
  }
  return content;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
  }
}

function setButtonBusy(button, isBusy, label) {
  button.disabled = isBusy;
  button.textContent = label;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

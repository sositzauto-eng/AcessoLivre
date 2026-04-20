import { AuthService } from './auth.js';
import { DuelService  } from './duel.js';
// questions.js e' o fallback offline — fonte principal e' a API Python

/* ═══════════════════════════════════════════════════════════
   ACESSO LIVRE — app.js v4
   Backend Python: TRI scoring, Gemini AI, Anti-Cheat
════════════════════════════════════════════════════════════ */
const app = {

    // ── URL da API Python no Railway ──────────────────────────────
    // Apos o deploy no Railway, troque a URL abaixo
    API_URL: (
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
    )
        ? 'http://localhost:8000'
        : 'https://acesso-livre-backend-production.up.railway.app',   // TROQUE APOS O DEPLOY

    // ── Cache local de questoes (evita chamadas repetidas na sessao) ──
    _questionsCache: {},

    // ── Respostas da sessao atual (para anti-cheat e TRI) ─────────
    _sessionAnswers:      [],  // [{correct, response_time_ms, suspicion}]
    _questionStartTime:   0,   // timestamp ao exibir cada questao
    _consecutiveFast:     0,   // contador de respostas rapidas seguidas
    _sessionCorrect:      0,   // acertos validados na sessao

    // ── Estado Global ─────────────────────────────────────────────
    currentUser:      null,
    userData:         null,
    currentArea:      null,
    currentQuestions: [],
    currentIndex:     0,
    correctCount:     0,
    isSignUp:         false,
    fontSize:         parseInt(localStorage.getItem('al_font') || '16'),

    // ── Estado do Duelo ───────────────────────────────────────────
    duelId:        null,
    duelData:      null,
    duelQuestions: [],
    duelIndex:     0,
    duelCorrect:   0,
    duelListener:  null,
    isDuelCreator: false,

    AREAS: ['linguagens', 'matematica', 'natureza', 'humanas'],

    AREA_META: {
        linguagens: { label: 'Linguagens',  icon: '📚', cls: 'lang' },
        matematica: { label: 'Matemática',  icon: '🔢', cls: 'math' },
        natureza:   { label: 'C. Natureza', icon: '🔬', cls: 'sci'  },
        humanas:    { label: 'C. Humanas',  icon: '🌍', cls: 'hum'  }
    },

    // ══════════════════════════════════════════════════════════════
    //  INICIALIZAÇÃO
    // ══════════════════════════════════════════════════════════════
    init() {
        this.applyFont();
        this.bindFontControls();
        this.bindAuth();
        this.bindNavEvents();
        this.bindDuelEvents();
        this.registerSW();

        // Captura duel ID da URL antes de qualquer coisa
        const urlParams     = new URLSearchParams(window.location.search);
        const pendingDuelId = urlParams.get('duelo');
        if (pendingDuelId) {
            sessionStorage.setItem('pending_duel', pendingDuelId);
            window.history.replaceState({}, '', window.location.pathname);
        }

        AuthService.onAuthStateChanged(async user => {
            if (user) {
                this.currentUser = user;
                await this.loadDashboard();

                const pending = sessionStorage.getItem('pending_duel');
                if (pending) {
                    sessionStorage.removeItem('pending_duel');
                    await this.joinDuelById(pending);
                } else {
                    this.showScreen('dashboard-screen');
                }
            } else {
                this.currentUser = null;
                this.userData    = null;
                this.showScreen('login-screen');
            }
        });
    },

    registerSW() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js').catch(() => {});
            });
        }
    },

    // ══════════════════════════════════════════════════════════════
    //  API — busca questões do backend Python
    // ══════════════════════════════════════════════════════════════
    async getQuestions(area) {
        // 1. Cache da sessão (evita chamar a API várias vezes)
        if (this._questionsCache[area]?.length) {
            return this._questionsCache[area];
        }

        // 2. Tenta a API Python no Railway
        try {
            const resp = await fetch(`${this.API_URL}/questions/${area}?limit=45`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
    if (data.questions?.length) {
                this._questionsCache[area] = data.questions;
                return data.questions;
            }
        } catch (e) {
            console.warn(`[API] Falha ao buscar questões para '${area}':`, e.message);
            this.toast(`Carregando questões offline para ${this.AREA_META[area]?.label}...`, 'info');
        }

        // 3. Fallback: questions.js (importado dinamicamente)
        try {
            const mod = await import('./questions.js');
            const qs  = mod.questions?.[area] || [];
            if (qs.length) {
                this._questionsCache[area] = qs;
                return qs;
            }
        } catch (e) {
            console.warn('[fallback] questions.js indisponível:', e.message);
        }

        return [];
    },

    // Busca análise de pontos fracos da API Python
    async fetchWeaknessAnalysis(area) {
        if (!this.currentUser) return null;
        try {
            const resp = await fetch(`${this.API_URL}/analysis/${this.currentUser.uid}/${area}`);
            if (!resp.ok) return null;
            return await resp.json();
        } catch (e) {
            console.warn('[API] Análise de pontos fracos indisponível:', e.message);
            return null;
        }
    },

    nomeDoEmail(email) {
        const prefix = (email || '').split('@')[0];
        return prefix
            .replace(/[._\-+]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase()) || 'Estudante';
    },

    // ══════════════════════════════════════════════════════════════
    //  DASHBOARD
    // ══════════════════════════════════════════════════════════════
    async loadDashboard() {
        try {
            this.userData = await AuthService.loadUserData(this.currentUser.uid);

            const savedNome     = this.userData?.nome;
            const isPlaceholder = !savedNome || savedNome === 'Usuário' || savedNome === 'Usuario';
            const resolvedName  =
                this.currentUser.displayName ||
                (isPlaceholder ? null : savedNome) ||
                this.nomeDoEmail(this.currentUser.email);

            if (isPlaceholder) {
                await AuthService.updateUserName(this.currentUser.uid, resolvedName);
                if (this.userData) this.userData.nome = resolvedName;
            }

            const el = document.getElementById('user-name');
            if (el) el.textContent = resolvedName.split(' ')[0];

            this.renderDashboard();
        } catch (err) {
            console.error('loadDashboard:', err);
        }
    },

    renderDashboard() {
        const progress     = this.userData?.progress || {};
        const allCompleted = this.AREAS.every(a => progress[a]?.completed);

        this.AREAS.forEach(area => {
            const data  = progress[area] || { currentIndex: 0, correctCount: 0, completed: false, score: 0 };
            const total = this._questionsCache[area]?.length || 45;
            const card  = document.getElementById(`card-${area}`);
            if (!card) return;

            const pctEl   = card.querySelector('.card-progress-fill');
            const labelEl = card.querySelector('.card-status-label');
            const scoreEl = card.querySelector('.card-score');
            const btnEl   = card.querySelector('.card-btn');
            const lockEl  = card.querySelector('.card-lock');

            const pct = data.completed ? 100 : Math.round((data.currentIndex / total) * 100);
            if (pctEl)   pctEl.style.width   = pct + '%';
            if (scoreEl) scoreEl.textContent = data.completed ? `${data.score} pts` : '';

            if (data.completed && !allCompleted) {
                if (labelEl) labelEl.textContent  = 'Concluída ✓';
                if (lockEl)  lockEl.style.display  = 'flex';
                if (btnEl) { btnEl.textContent = '✓ Concluída'; btnEl.disabled = true; }
                card.classList.add('card-done');
            } else if (data.completed && allCompleted) {
                if (labelEl) labelEl.textContent  = 'Refazer';
                if (lockEl)  lockEl.style.display  = 'none';
                if (btnEl) { btnEl.textContent = '↺ Refazer'; btnEl.disabled = false; }
                card.classList.remove('card-done');
            } else if (data.currentIndex > 0) {
                if (labelEl) labelEl.textContent  = `${data.currentIndex}/${total} questões`;
                if (lockEl)  lockEl.style.display  = 'none';
                if (btnEl) { btnEl.textContent = '▶ Continuar'; btnEl.disabled = false; }
                card.classList.remove('card-done');
            } else {
                if (labelEl) labelEl.textContent  = `0/${total} questões`;
                if (lockEl)  lockEl.style.display  = 'none';
                if (btnEl) { btnEl.textContent = '→ Iniciar'; btnEl.disabled = false; }
                card.classList.remove('card-done');
            }
        });

        const completedCount = this.AREAS.filter(a => progress[a]?.completed).length;
        const progressBanner = document.getElementById('overall-progress');
        if (progressBanner) {
            progressBanner.textContent = `${completedCount}/4 áreas concluídas`;
            progressBanner.className   = completedCount === 4 ? 'overall-complete' : 'overall-progress';
        }

        const notaBanner = document.getElementById('nota-banner');
        if (notaBanner) {
            if (allCompleted && this.userData?.totalScore) {
                notaBanner.innerHTML =
                    `<span class="nota-label">Sua Nota ENEM</span>
                     <span class="nota-value">${this.userData.totalScore}</span>
                     <span class="nota-sub">${this.getScoreLevel(this.userData.totalScore)}</span>`;
                notaBanner.style.display = 'flex';
            } else {
                notaBanner.style.display = 'none';
            }
        }

        const btnReset = document.getElementById('btn-reset-all');
        if (btnReset) btnReset.style.display = allCompleted ? 'flex' : 'none';
    },

    // ══════════════════════════════════════════════════════════════
    //  QUIZ NORMAL
    // ══════════════════════════════════════════════════════════════
    async startQuiz(area) {
        const qs = await this.getQuestions(area);
        if (!qs?.length) { this.toast('Área não disponível.', 'warn'); return; }

        const progress     = this.userData?.progress || {};
        const areaData     = progress[area] || {};
        const allCompleted = this.AREAS.every(a => progress[a]?.completed);

        if (areaData.completed && !allCompleted) {
            this.toast('Conclua as outras áreas para poder reiniciar!', 'info'); return;
        }
        if (allCompleted) {
            const ok = await this.confirmReset();
            if (!ok) return;
            await this.doResetAll();
        }

        this.currentArea      = area;
        this.currentQuestions = qs;
        this._sessionAnswers  = [];
        this._sessionCorrect  = 0;
        this._consecutiveFast = 0;

        const saved           = this.userData?.progress?.[area] || {};
        this.currentIndex     = saved.completed ? 0 : (saved.currentIndex || 0);
        this.correctCount     = saved.completed ? 0 : (saved.correctCount || 0);

        const meta    = this.AREA_META[area];
        const titleEl = document.getElementById('quiz-area-title');
        if (titleEl) titleEl.textContent = `${meta.icon} ${meta.label}`;
        const bar = document.getElementById('quiz-progress-bar');
        if (bar) bar.className = `quiz-bar-fill ${meta.cls}`;

        this.showScreen('quiz-screen');
        this.loadQuestion();
    },

    loadQuestion() {
        if (this.currentIndex >= this.currentQuestions.length) { this.finishQuiz(); return; }

        const q     = this.currentQuestions[this.currentIndex];
        const total = this.currentQuestions.length;

        const bar = document.getElementById('quiz-progress-bar');
        if (bar) bar.style.width = Math.round((this.currentIndex / total) * 100) + '%';
        const counter = document.getElementById('quiz-counter');
        if (counter) counter.textContent = `${this.currentIndex + 1} / ${total}`;

        document.getElementById('question-text').textContent = q.pergunta;
        document.getElementById('feedback-area').classList.add('hidden');
        this._questionStartTime = Date.now(); // anti-cheat timing
        this._questionStartTime = Date.now(); // anti-cheat: marca inicio da questao

        const list = document.getElementById('options-list');
        list.innerHTML = '';
        Object.entries(q.alternativas).forEach(([letra, texto]) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerHTML = `<span class="opt-letter">${letra}</span><span class="opt-text">${texto}</span>`;
            btn.addEventListener('click', () => this.checkAnswer(letra, q, btn));
            list.appendChild(btn);
        });

        const qs = document.getElementById('quiz-scroll');
        if (qs) qs.scrollTop = 0;
    },

    async checkAnswer(escolha, questao, botao) {
        document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
        const responseTimeMs = Date.now() - (this._questionStartTime || Date.now());
        const isCorrect      = escolha === questao.correta;

        // Envia para API Python: anti-cheat + log + explicacao por IA
        let aiExplanation = null;
        let validadoPelaAPI = false;
        try {
            const resp = await fetch(`${this.API_URL}/answer`, {
                method:  'POST',
                headers: {'Content-Type': 'application/json'},
                body:    JSON.stringify({
                    uid:                 this.currentUser?.uid || 'anon',
                    area:                this.currentArea,
                    question_id:         `${this.currentArea}_${this.currentIndex}`,
                    answer:              escolha,
                    correct_answer:      questao.correta,
                    is_correct:          isCorrect,
                    response_time_ms:    responseTimeMs,
                    question_data:       questao,
                    consecutive_fast:    this._consecutiveFast  || 0,
                    session_correct_pct: this._sessionAnswers.length > 0
                        ? this._sessionCorrect / this._sessionAnswers.length : 0.5,
                    total_answered:      this._sessionAnswers.length + 1,
                }),
            });
            if (resp.ok) {
                const data = await resp.json();
                validadoPelaAPI = true;
                if (!data.accepted) {
                    this.toast('Resposta muito rápida! Leia com atenção.', 'warn');
                }
                this._consecutiveFast = (data.suspicion === 'warning' || data.suspicion === 'suspicious')
                    ? (this._consecutiveFast || 0) + 1 : 0;
                if (data.ai_explanation) aiExplanation = data.ai_explanation;
                if (isCorrect && data.effective_correct) this.correctCount++;
            }
        } catch (_) { /* API offline — funciona normalmente */ }

        if (!validadoPelaAPI && isCorrect) this.correctCount++;

        this._sessionAnswers.push({ correct: isCorrect, response_time_ms: responseTimeMs });
        if (isCorrect) this._sessionCorrect = (this._sessionCorrect || 0) + 1;

        if (isCorrect) {
            botao.classList.add('opt-correct');
            document.getElementById('feedback-icon').textContent   = '✓';
            document.getElementById('feedback-icon').className     = 'fb-icon fb-correct';
            document.getElementById('feedback-status').textContent = 'Resposta Correta!';
            document.getElementById('feedback-status').className   = 'fb-title fb-correct-text';
        } else {
            botao.classList.add('opt-wrong');
            document.getElementById('feedback-icon').textContent   = '✗';
            document.getElementById('feedback-icon').className     = 'fb-icon fb-wrong';
            document.getElementById('feedback-status').textContent = 'Resposta Incorreta';
            document.getElementById('feedback-status').className   = 'fb-title fb-wrong-text';
            document.querySelectorAll('.option-btn').forEach(b => {
                if (b.querySelector('.opt-letter')?.textContent === questao.correta)
                    b.classList.add('opt-correct');
            });
        }
        document.getElementById('explanation-text').textContent =
            aiExplanation || questao.explicacao?.correta || '';
        document.getElementById('feedback-area').classList.remove('hidden');

        this._syncProgress(this.currentArea, {
            currentIndex: this.currentIndex + 1,
            correctCount: this.correctCount,
            completed:    false,
            score:        0
        });
    },

    nextQuestion() {
        this.currentIndex++;
        if (this.currentIndex < this.currentQuestions.length) this.loadQuestion();
        else this.finishQuiz();
    },

    async finishQuiz() {
        const total = this.currentQuestions.length;

        // Calcula nota via TRI no Python (seguro, nao hackavel)
        let score = this.calcScore(this.correctCount, total); // fallback JS
        try {
            const responses = this._sessionAnswers.map(a => a.correct);
            // Preenche com false se nao respondeu todas (retomada de progresso)
            while (responses.length < total) responses.push(false);
            const resp = await fetch(`${this.API_URL}/score`, {
                method:  'POST',
                headers: {'Content-Type': 'application/json'},
                body:    JSON.stringify({
                    uid:       this.currentUser?.uid || 'anonymous',
                    area:      this.currentArea,
                    responses: responses,
                }),
            });
            if (resp.ok) {
                const data = await resp.json();
                score = data.score || score;
            }
        } catch (e) {
            console.warn('[score] API indisponivel, usando calculo local:', e.message);
        }

        const completedAreaData = { currentIndex: total, correctCount: this.correctCount, completed: true, score };

        await this._syncProgress(this.currentArea, completedAreaData);
        if (!this.userData)          this.userData          = {};
        if (!this.userData.progress) this.userData.progress = {};
        this.userData.progress[this.currentArea] = completedAreaData;

        const allCompleted = this.AREAS.every(a => this.userData.progress[a]?.completed);

        if (allCompleted) {
            const totalScore = this.calcTotalScore();
            this.userData.totalScore   = totalScore;
            this.userData.allCompleted = true;
            try { await AuthService.saveScores(this.currentUser.uid, this.userData.progress, totalScore); }
            catch (e) { console.warn(e); }
            this.showAllCompleteModal(totalScore);
        } else {
            this.showAreaCompleteModal(score, this.correctCount, total);
        }
    },

    // ══════════════════════════════════════════════════════════════
    //  DUELO 1v1
    // ══════════════════════════════════════════════════════════════

    // Abre modal de seleção de área para o duelo
    showDuelSetup() {
        document.getElementById('duel-setup-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('duel-setup-modal').classList.add('modal-in'), 10);
    },

    // Cria duelo e vai para a sala de espera
    async createDuel(area) {
        this.closeModal('duel-setup-modal');

        const nome    = this.userData?.nome || this.nomeDoEmail(this.currentUser.email);
        const allQ    = await this.getQuestions(area);
        if (!allQ?.length) { this.toast('Questões indisponíveis. Tente novamente.', 'warn'); return; }
        const indices = this._randomIndices(allQ.length, 10);

        try {
            const duelId = await DuelService.create(this.currentUser.uid, nome, area, indices);
            this.duelId        = duelId;
            this.isDuelCreator = true;
            this.duelQuestions = indices.map(i => allQ[i]);
            this.duelIndex     = 0;
            this.duelCorrect   = 0;

            this._showDuelLobby(duelId, area, nome, 'creator');

            // Ouve mudanças em tempo real
            if (this.duelListener) this.duelListener();
            this.duelListener = DuelService.listen(duelId, duel => {
                this.duelData = duel;
                this._onDuelUpdate(duel);
            });
        } catch (e) {
            this.toast('Erro ao criar duelo: ' + e.message, 'error');
        }
    },

    // Entrar no duelo via URL ?duelo=ID
    async joinDuelById(duelId) {
        const nome = this.userData?.nome || this.nomeDoEmail(this.currentUser.email);
        try {
            const data = await DuelService.join(duelId, this.currentUser.uid, nome);
            this.duelId        = duelId;
            this.isDuelCreator = false;
            const area         = data.area;
            const duelAllQ    = await this.getQuestions(area);
            this.duelQuestions = data.questionIndices.map(i => duelAllQ[i]).filter(Boolean);
            this.duelIndex     = 0;
            this.duelCorrect   = 0;

            this._showDuelLobby(duelId, area, nome, 'opponent');

            if (this.duelListener) this.duelListener();
            this.duelListener = DuelService.listen(duelId, duel => {
                this.duelData = duel;
                this._onDuelUpdate(duel);
            });
        } catch (e) {
            await this.loadDashboard();
            this.showScreen('dashboard-screen');
            this.toast(e.message, 'error');
        }
    },

    _showDuelLobby(duelId, area, myName, role) {
        const meta     = this.AREA_META[area];
        const shareUrl = `${window.location.origin}${window.location.pathname}?duelo=${duelId}`;
        const waText   = encodeURIComponent(
            `⚔️ *Duelo no Acesso Livre!*\n` +
            `*${myName}* te desafia em *${meta.label}* ${meta.icon}\n\n` +
            `Toque para aceitar o desafio:\n👉 ${shareUrl}`
        );

        document.getElementById('lobby-area-icon').textContent = meta.icon;
        document.getElementById('lobby-area-name').textContent = meta.label;
        document.getElementById('lobby-my-name').textContent   = myName;
        document.getElementById('lobby-duel-link').value       = shareUrl;

        const waBtn = document.getElementById('lobby-wa-btn');
        if (waBtn) waBtn.href = `https://wa.me/?text=${waText}`;

        const statusEl  = document.getElementById('lobby-opponent-status');
        const opNameEl  = document.getElementById('lobby-opponent-name');
        const startBtn  = document.getElementById('lobby-start-btn');

        if (role === 'creator') {
            if (statusEl)  statusEl.textContent = '⏳ Aguardando adversário...';
            if (opNameEl)  opNameEl.textContent  = '?';
            if (startBtn)  { startBtn.style.display = 'none'; }
        } else {
            // Opponent joined — show creator info if available
            if (statusEl)  statusEl.textContent = '✅ Duelo encontrado!';
            if (startBtn)  { startBtn.style.display = 'flex'; startBtn.textContent = '▶ Iniciar Duelo'; }
        }

        this.showScreen('duel-lobby-screen');
    },

    // Responde a atualizações do Firestore em tempo real
    _onDuelUpdate(duel) {
        const players = Object.keys(duel.jogadores);
        const active  = document.querySelector('.screen.active')?.id;

        // Lobby: adversário entrou
        if (active === 'duel-lobby-screen' && duel.status === 'em_andamento' && players.length === 2) {
            const uid       = this.currentUser.uid;
            const otherUid  = players.find(k => k !== uid);
            const otherNome = duel.jogadores[otherUid]?.nome || 'Adversário';

            const statusEl  = document.getElementById('lobby-opponent-status');
            const opNameEl  = document.getElementById('lobby-opponent-name');
            const startBtn  = document.getElementById('lobby-start-btn');

            if (statusEl)  statusEl.textContent = `✅ ${otherNome} entrou!`;
            if (opNameEl)  opNameEl.textContent  = otherNome;
            if (startBtn)  { startBtn.style.display = 'flex'; startBtn.textContent = '▶ Começar!'; }
        }

        // Quiz: atualiza progresso do adversário
        if (active === 'duel-quiz-screen' && players.length === 2) {
            this._updateOpponentProgress(duel);
        }

        // Finalizado
        if (duel.status === 'finalizado') {
            this._showDuelResults(duel);
        }
    },

    startDuelQuiz() {
        const meta    = this.AREA_META[this.duelData?.area || this.currentArea];
        const titleEl = document.getElementById('duel-quiz-area-title');
        if (titleEl) titleEl.textContent = `${meta.icon} ${meta.label}`;
        const bar = document.getElementById('duel-progress-bar');
        if (bar) bar.className = `quiz-bar-fill ${meta.cls}`;

        this.showScreen('duel-quiz-screen');
        this._loadDuelQuestion();
    },

    _loadDuelQuestion() {
        if (this.duelIndex >= this.duelQuestions.length) {
            this._finishDuelQuiz(); return;
        }

        const q     = this.duelQuestions[this.duelIndex];
        const total = this.duelQuestions.length;

        const bar = document.getElementById('duel-progress-bar');
        if (bar) bar.style.width = Math.round((this.duelIndex / total) * 100) + '%';

        const counter = document.getElementById('duel-counter');
        if (counter) counter.textContent = `${this.duelIndex + 1} / ${total}`;

        document.getElementById('duel-question-text').textContent = q.pergunta;
        document.getElementById('duel-feedback-area').classList.add('hidden');

        const list = document.getElementById('duel-options-list');
        list.innerHTML = '';
        Object.entries(q.alternativas).forEach(([letra, texto]) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerHTML = `<span class="opt-letter">${letra}</span><span class="opt-text">${texto}</span>`;
            btn.addEventListener('click', () => this._checkDuelAnswer(letra, q, btn));
            list.appendChild(btn);
        });

        const ds = document.getElementById('duel-scroll');
        if (ds) ds.scrollTop = 0;
    },

    async _checkDuelAnswer(escolha, questao, botao) {
        document.querySelectorAll('#duel-options-list .option-btn').forEach(b => b.disabled = true);
        const isCorrect = escolha === questao.correta;

        if (isCorrect) {
            botao.classList.add('opt-correct');
            this.duelCorrect++;
            document.getElementById('duel-fb-icon').textContent   = '✓';
            document.getElementById('duel-fb-icon').className     = 'fb-icon fb-correct';
            document.getElementById('duel-fb-status').textContent = 'Resposta Correta!';
            document.getElementById('duel-fb-status').className   = 'fb-title fb-correct-text';
        } else {
            botao.classList.add('opt-wrong');
            document.getElementById('duel-fb-icon').textContent   = '✗';
            document.getElementById('duel-fb-icon').className     = 'fb-icon fb-wrong';
            document.getElementById('duel-fb-status').textContent = 'Resposta Incorreta';
            document.getElementById('duel-fb-status').className   = 'fb-title fb-wrong-text';
            document.querySelectorAll('#duel-options-list .option-btn').forEach(b => {
                if (b.querySelector('.opt-letter')?.textContent === questao.correta) b.classList.add('opt-correct');
            });
        }
        document.getElementById('duel-explanation-text').textContent = questao.explicacao.correta;
        document.getElementById('duel-feedback-area').classList.remove('hidden');

        // Salva resposta no Firestore
        try {
            await DuelService.saveAnswer(this.duelId, this.currentUser.uid, this.duelIndex, escolha);
        } catch (e) { console.warn(e); }
    },

    nextDuelQuestion() {
        this.duelIndex++;
        if (this.duelIndex < this.duelQuestions.length) this._loadDuelQuestion();
        else this._finishDuelQuiz();
    },

    async _finishDuelQuiz() {
        const score = this.calcScore(this.duelCorrect, this.duelQuestions.length);
        this.showScreen('duel-waiting-screen');

        try {
            await DuelService.finish(this.duelId, this.currentUser.uid, this.duelCorrect, score);
        } catch (e) { console.warn(e); }

        // Se o adversário já terminou, o listener vai detectar status=finalizado e chamar _showDuelResults
    },

    _updateOpponentProgress(duel) {
        const uid      = this.currentUser.uid;
        const otherUid = Object.keys(duel.jogadores).find(k => k !== uid);
        if (!otherUid) return;

        const answered   = Object.keys(duel.jogadores[otherUid]?.respostas || {}).length;
        const total      = this.duelQuestions.length;
        const el         = document.getElementById('duel-opp-progress');
        const barEl      = document.getElementById('duel-opp-bar');
        const nome       = duel.jogadores[otherUid]?.nome || 'Adversário';

        if (el)    el.textContent      = `${nome}: ${answered}/${total}`;
        if (barEl) barEl.style.width   = Math.round((answered / total) * 100) + '%';
    },

    _showDuelResults(duel) {
        if (this.duelListener) { this.duelListener(); this.duelListener = null; }

        const uid      = this.currentUser.uid;
        const players  = Object.entries(duel.jogadores);
        const me       = duel.jogadores[uid];
        const otherUid = players.find(([k]) => k !== uid)?.[0];
        const other    = otherUid ? duel.jogadores[otherUid] : null;

        const meta     = this.AREA_META[duel.area];
        const myScore  = me?.score    || 0;
        const myHits   = me?.acertos  || 0;
        const oppScore = other?.score  || 0;
        const oppHits  = other?.acertos || 0;
        const oppNome  = other?.nome   || 'Adversário';

        let outcome, outcomeClass;
        if (!other)                     { outcome = '🏆 Vitória!';  outcomeClass = 'outcome-win'; }
        else if (myScore > oppScore)    { outcome = '🏆 Vitória!';  outcomeClass = 'outcome-win'; }
        else if (myScore < oppScore)    { outcome = '💪 Derrota!';  outcomeClass = 'outcome-loss'; }
        else                            { outcome = '🤝 Empate!';   outcomeClass = 'outcome-draw'; }

        document.getElementById('duel-res-outcome').textContent = outcome;
        document.getElementById('duel-res-outcome').className   = `duel-res-outcome ${outcomeClass}`;
        document.getElementById('duel-res-area').textContent    = `${meta.icon} ${meta.label}`;

        // Minha coluna
        document.getElementById('duel-res-my-name').textContent  = (me?.nome || 'Você').split(' ')[0];
        document.getElementById('duel-res-my-score').textContent = myScore;
        document.getElementById('duel-res-my-hits').textContent  = `${myHits}/10`;

        // Coluna adversário
        document.getElementById('duel-res-opp-name').textContent  = oppNome.split(' ')[0];
        document.getElementById('duel-res-opp-score').textContent = other ? oppScore : '—';
        document.getElementById('duel-res-opp-hits').textContent  = other ? `${oppHits}/10` : '—';

        // Destaque do vencedor
        const myCol  = document.getElementById('duel-res-my-col');
        const oppCol = document.getElementById('duel-res-opp-col');
        myCol?.classList.toggle('res-winner',  myScore > oppScore);
        oppCol?.classList.toggle('res-winner', other && oppScore > myScore);

        // Guarda dados para o share card do duelo
        this._lastDuelResult = {
            myName: me?.nome || 'Você', myScore, myHits,
            oppName: oppNome, oppScore, oppHits,
            area: duel.area, outcome,
            total: this.duelQuestions.length
        };

        this.showScreen('duel-result-screen');
    },

    cancelDuel() {
        if (this.duelListener) { this.duelListener(); this.duelListener = null; }
        this.duelId = null;
        this.loadDashboard().then(() => this.showScreen('dashboard-screen'));
    },

    // ══════════════════════════════════════════════════════════════
    //  COMPARTILHAMENTO DE RESULTADO — Canvas Card
    // ══════════════════════════════════════════════════════════════
    async showShareCard({ area, score, correct, total, isDuel = false, duelData = null }) {
        const canvas  = await this._generateCard({ area, score, correct, total, isDuel, duelData });
        const dataUrl = canvas.toDataURL('image/png');

        // Mostra preview no modal
        const preview = document.getElementById('share-card-preview');
        if (preview) {
            preview.innerHTML = '';
            const img = document.createElement('img');
            img.src   = dataUrl;
            img.style.cssText = 'width:100%;border-radius:16px;display:block;';
            preview.appendChild(img);
        }

        // Gera texto para WhatsApp
        const meta     = this.AREA_META[area];
        const levelTxt = this.getScoreLevel(score);
        let waText;

        if (isDuel && duelData) {
            const winner = duelData.myScore > duelData.oppScore ? duelData.myName : duelData.oppName;
            waText = encodeURIComponent(
                `⚔️ *Duelo no Acesso Livre ENEM!*\n` +
                `${duelData.myName} ${duelData.myScore} × ${duelData.oppScore} ${duelData.oppName}\n` +
                `🏆 ${winner} venceu em *${meta.label}*!\n\n` +
                `Estude grátis: ${window.location.origin}${window.location.pathname}`
            );
        } else {
            waText = encodeURIComponent(
                `🎯 Tirei *${score} pontos* em *${meta.label}* no Acesso Livre ENEM!\n` +
                `${levelTxt}\n\n` +
                `Estude grátis: ${window.location.origin}${window.location.pathname}`
            );
        }

        const waBtn = document.getElementById('share-wa-btn');
        if (waBtn) waBtn.href = `https://wa.me/?text=${waText}`;

        // Botão download / Web Share API
        const nativeBtn = document.getElementById('share-native-btn');
        if (nativeBtn) {
            nativeBtn.onclick = async () => {
                if (navigator.share && navigator.canShare) {
                    try {
                        const blob  = await (await fetch(dataUrl)).blob();
                        const file  = new File([blob], 'acesso-livre-resultado.png', { type: 'image/png' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({ files: [file], title: 'Acesso Livre — Meu Resultado' });
                            return;
                        }
                    } catch (e) { /* fallback */ }
                }
                // Fallback: download
                const a  = document.createElement('a');
                a.href   = dataUrl;
                a.download = 'acesso-livre-resultado.png';
                a.click();
            };
        }

        document.getElementById('share-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('share-modal').classList.add('modal-in'), 10);
    },

    async _generateCard({ area, score, correct, total, isDuel = false, duelData = null }) {
        const W = 1080, H = 1080;
        const canvas = document.createElement('canvas');
        canvas.width  = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');

        const meta   = this.AREA_META[area];

        // ── Fundo gradiente ───────────────────────────────────────
        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0,   '#051E13');
        grad.addColorStop(0.5, '#0A3D28');
        grad.addColorStop(1,   '#0F6B47');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // ── Círculos decorativos ──────────────────────────────────
        const drawCircle = (x, y, r, alpha) => {
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(31, 209, 127, ${alpha})`;
            ctx.fill();
        };
        drawCircle(W, 0, 350, 0.08);
        drawCircle(0, H, 280, 0.06);
        drawCircle(W * 0.5, H * 0.3, 500, 0.03);

        // ── Logo ──────────────────────────────────────────────────
        try {
            const logo = await this._loadImage('./logo.png');
            const logoSize = 90;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(52, 50, logoSize, logoSize, 18);
            ctx.clip();
            ctx.drawImage(logo, 52, 50, logoSize, logoSize);
            ctx.restore();
        } catch { /* ignora se logo não carregar */ }

        // ── App name ──────────────────────────────────────────────
        ctx.fillStyle = '#1FD17F';
        ctx.font      = 'bold 38px Arial, sans-serif';
        ctx.fillText('ACESSO LIVRE', 158, 85);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font      = '28px Arial, sans-serif';
        ctx.fillText('Simulado ENEM', 158, 122);

        // ── Linha separadora ──────────────────────────────────────
        ctx.strokeStyle = 'rgba(31,209,127,0.3)';
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.moveTo(52, 162); ctx.lineTo(W - 52, 162); ctx.stroke();

        if (!isDuel) {
            // ── Card Resultado Individual ─────────────────────────
            const centerY = H * 0.5;

            // Ícone da área
            ctx.font      = '120px serif';
            ctx.textAlign = 'center';
            ctx.fillText(meta.icon, W / 2, centerY - 180);

            // Nome da área
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.font      = 'bold 42px Arial, sans-serif';
            ctx.fillText(meta.label.toUpperCase(), W / 2, centerY - 80);

            // Pontuação
            ctx.fillStyle = '#1FD17F';
            ctx.font      = 'bold 200px Arial, sans-serif';
            ctx.fillText(score.toString(), W / 2, centerY + 110);

            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font      = '40px Arial, sans-serif';
            ctx.fillText('pontos', W / 2, centerY + 170);

            // Nível
            ctx.fillStyle = '#FFFFFF';
            ctx.font      = 'bold 48px Arial, sans-serif';
            ctx.fillText(this.getScoreLevel(score), W / 2, centerY + 250);

            // Acertos
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font      = '36px Arial, sans-serif';
            ctx.fillText(`${correct} de ${total} questões corretas`, W / 2, centerY + 320);

        } else if (duelData) {
            // ── Card Duelo ────────────────────────────────────────
            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFFFFF';
            ctx.font      = 'bold 58px Arial, sans-serif';
            ctx.fillText('⚔️  DUELO', W / 2, 270);

            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font      = '34px Arial, sans-serif';
            ctx.fillText(`${meta.icon} ${meta.label}`, W / 2, 328);

            // VS divider
            const midY = H * 0.52;
            ctx.fillStyle  = '#1FD17F';
            ctx.font       = 'bold 80px Arial, sans-serif';
            ctx.fillText('VS', W / 2, midY);

            const drawPlayer = (nome, score, hits, x, isWinner) => {
                ctx.textAlign = 'center';
                if (isWinner) {
                    ctx.fillStyle  = '#1FD17F';
                    ctx.font       = 'bold 34px Arial, sans-serif';
                    ctx.fillText('🏆 ' + nome.split(' ')[0], x, midY - 220);
                } else {
                    ctx.fillStyle  = 'rgba(255,255,255,0.75)';
                    ctx.font       = 'bold 34px Arial, sans-serif';
                    ctx.fillText(nome.split(' ')[0], x, midY - 220);
                }
                const scoreColor = isWinner ? '#1FD17F' : 'rgba(255,255,255,0.65)';
                ctx.fillStyle = scoreColor;
                ctx.font      = `bold ${isWinner ? 130 : 110}px Arial, sans-serif`;
                ctx.fillText(score.toString(), x, midY - 60);
                ctx.fillStyle = 'rgba(255,255,255,0.45)';
                ctx.font      = '30px Arial, sans-serif';
                ctx.fillText(`${hits}/10 corretas`, x, midY - 12);
            };

            const myWin  = duelData.myScore  > duelData.oppScore;
            const oppWin = duelData.oppScore > duelData.myScore;
            drawPlayer(duelData.myName,  duelData.myScore,  duelData.myHits,  W * 0.27, myWin);
            drawPlayer(duelData.oppName, duelData.oppScore, duelData.oppHits, W * 0.73, oppWin);

            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFFFFF';
            ctx.font      = 'bold 52px Arial, sans-serif';
            ctx.fillText(duelData.outcome, W / 2, midY + 160);
        }

        // ── Rodapé ────────────────────────────────────────────────
        ctx.strokeStyle = 'rgba(31,209,127,0.3)';
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.moveTo(52, H - 100); ctx.lineTo(W - 52, H - 100); ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font      = '28px Arial, sans-serif';
        const url     = window.location.hostname || 'Acesso Livre ENEM';
        ctx.fillText(url, W / 2, H - 52);

        return canvas;
    },

    _loadImage(src) {
        return new Promise((res, rej) => {
            const img  = new Image();
            img.onload  = () => res(img);
            img.onerror = rej;
            img.src     = src;
        });
    },

    // ══════════════════════════════════════════════════════════════
    //  NOTAS PESSOAIS / RANKING
    // ══════════════════════════════════════════════════════════════
    showScores() {
        const progress = this.userData?.progress || {};
        this.AREAS.forEach(area => {
            const data    = progress[area] || {};
            const row     = document.getElementById(`scores-row-${area}`);
            const scoreEl = document.getElementById(`scores-val-${area}`);
            const barEl   = document.getElementById(`scores-bar-${area}`);
            if (!row) return;
            if (data.completed) {
                if (scoreEl) scoreEl.textContent = data.score;
                if (barEl)   barEl.style.width   = Math.round((data.score - 300) / 650 * 100) + '%';
                row.classList.remove('score-row-pending');
            } else {
                const answered = data.currentIndex || 0;
                const total    = this._questionsCache[area]?.length || 45;
                if (scoreEl) scoreEl.textContent = `${answered}/${total}`;
                if (barEl)   barEl.style.width   = Math.round(answered / total * 100) + '%';
                row.classList.add('score-row-pending');
            }
        });
        const totalEl      = document.getElementById('scores-total');
        const allCompleted = this.AREAS.every(a => progress[a]?.completed);
        if (totalEl) totalEl.textContent = allCompleted ? (this.userData?.totalScore || '—') : '—';

        // Botões de compartilhar por área
        this.AREAS.forEach(area => {
            const btn = document.getElementById(`share-btn-${area}`);
            if (!btn) return;
            const data = progress[area];
            if (data?.completed) {
                btn.style.display = 'flex';
                btn.onclick = () => this.showShareCard({
                    area,
                    score:   data.score,
                    correct: data.correctCount,
                    total:   this._questionsCache[area]?.length || 45
                });
            } else {
                btn.style.display = 'none';
            }
        });

        this.showScreen('scores-screen');
    },

    async showRanking() {
        this.showScreen('ranking-screen');
        const list = document.getElementById('ranking-list');
        list.innerHTML = `<div class="ranking-loading"><span class="spinner"></span> Carregando...</div>`;
        try {
            const users = await AuthService.getRanking();
            this.renderRanking(users);
        } catch {
            list.innerHTML = `<div class="ranking-empty">Erro ao carregar o ranking.</div>`;
        }
    },

    renderRanking(users) {
        const list   = document.getElementById('ranking-list');
        const uid    = this.currentUser?.uid;
        const medals = ['🥇', '🥈', '🥉'];
        if (!users?.length) {
            list.innerHTML = `<div class="ranking-empty">Nenhum usuário ainda no ranking.<br>Conclua o caderno para aparecer aqui! 🏆</div>`;
            return;
        }
        list.innerHTML = users.slice(0, 50).map((u, i) => {
            const isMe      = u.uid === uid;
            const pos       = i < 3 ? `<span class="rank-medal">${medals[i]}</span>` : `<span class="rank-pos">${i+1}º</span>`;
            const badge     = u.allCompleted
                ? `<span class="rank-badge">Caderno Completo</span>`
                : `<span class="rank-badge-partial">${u.completedAreas}/4 áreas</span>`;
            const scoreText = u.allCompleted ? u.totalScore : (u.totalScore || '—');
            return `
            <div class="ranking-item ${isMe ? 'ranking-me' : ''} ${i < 3 ? `rank-top-${i+1}` : ''}">
                <div class="rank-left">${pos}
                    <div class="rank-info">
                        <span class="rank-name">${this.escapeHtml(u.nome)}${isMe ? ' <span class="rank-you">(você)</span>' : ''}</span>
                        ${badge}
                    </div>
                </div>
                <span class="rank-score">${scoreText}</span>
            </div>`;
        }).join('');
    },

    // ══════════════════════════════════════════════════════════════
    //  MODAIS E HELPERS
    // ══════════════════════════════════════════════════════════════
    showAreaCompleteModal(score, correct, total) {
        const meta = this.AREA_META[this.currentArea];
        document.getElementById('ac-icon').textContent     = meta.icon;
        document.getElementById('ac-area').textContent     = meta.label;
        document.getElementById('ac-score').textContent    = score;
        document.getElementById('ac-fraction').textContent = `${correct} de ${total} corretas`;
        document.getElementById('ac-level').textContent    = this.getScoreLevel(score);
        document.getElementById('ac-ring').style.background =
            `conic-gradient(var(--brand-accent) ${Math.round(correct/total*360)}deg, #E2E8F0 0deg)`;

        // Botão compartilhar neste modal
        const btnShare = document.getElementById('ac-btn-share');
        if (btnShare) {
            btnShare.onclick = () => {
                this.closeModal('area-complete-modal');
                this.showShareCard({ area: this.currentArea, score, correct, total });
            };
        }

        document.getElementById('area-complete-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('area-complete-modal').classList.add('modal-in'), 10);
    },

    showAllCompleteModal(totalScore) {
        document.getElementById('allc-total').textContent = totalScore;
        document.getElementById('allc-level').textContent = this.getScoreLevel(totalScore);
        const progress = this.userData.progress;
        this.AREAS.forEach(a => {
            const el = document.getElementById(`allc-${a}`);
            if (el) el.textContent = progress[a]?.score || 0;
        });

        const btnShare = document.getElementById('allc-btn-share');
        if (btnShare) {
            btnShare.onclick = () => {
                this.closeModal('all-complete-modal');
                // Compartilha a melhor nota
                const bestArea = this.AREAS.reduce((a, b) =>
                    (progress[a]?.score || 0) > (progress[b]?.score || 0) ? a : b
                );
                this.showShareCard({
                    area:    bestArea,
                    score:   progress[bestArea]?.score || 0,
                    correct: progress[bestArea]?.correctCount || 0,
                    total:   this._questionsCache[bestArea]?.length || 45
                });
            };
        }

        document.getElementById('all-complete-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('all-complete-modal').classList.add('modal-in'), 10);
    },

    closeModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('modal-in');
        setTimeout(() => el.classList.add('hidden'), 280);
    },

    confirmReset() {
        return new Promise(resolve => {
            document.getElementById('confirm-modal').classList.remove('hidden');
            setTimeout(() => document.getElementById('confirm-modal').classList.add('modal-in'), 10);
            document.getElementById('confirm-yes').addEventListener('click', () => {
                this.closeModal('confirm-modal'); resolve(true);
            }, { once: true });
            document.getElementById('confirm-no').addEventListener('click', () => {
                this.closeModal('confirm-modal'); resolve(false);
            }, { once: true });
        });
    },

    async doResetAll() {
        try { await AuthService.resetProgress(this.currentUser.uid); } catch (e) { console.warn(e); }
        if (!this.userData) this.userData = {};
        this.userData.allCompleted = false;
        this.userData.totalScore   = 0;
        this.userData.progress     = {};
        this.AREAS.forEach(a => {
            this.userData.progress[a] = { currentIndex: 0, correctCount: 0, completed: false, score: 0 };
        });
        await this.loadDashboard();
        this.renderDashboard();
    },

    // ── Cálculos ──────────────────────────────────────────────────
    calcScore(correct, total) {
        if (!total) return 0;
        return Math.round(300 + Math.pow(correct / total, 0.85) * 650);
    },
    calcTotalScore() {
        const scores = this.AREAS.map(a => this.userData?.progress?.[a]?.score || 0);
        return Math.round(scores.reduce((s, v) => s + v, 0) / this.AREAS.length);
    },
    getScoreLevel(score) {
        if (score >= 850) return '🏆 Excelente!';
        if (score >= 700) return '⭐ Muito Bom';
        if (score >= 550) return '✅ Bom';
        if (score >= 420) return '📚 Em Desenvolvimento';
        return '💪 Continue Estudando!';
    },

    // ── Tamanho de Fonte ──────────────────────────────────────────
    applyFont() {
        document.documentElement.style.setProperty('--base-font', this.fontSize + 'px');
        const display = document.getElementById('font-display');
        if (display) display.textContent = this.fontSize + 'px';
    },
    bindFontControls() {
        document.getElementById('btn-font-dec')?.addEventListener('click', () => {
            if (this.fontSize > 13) { this.fontSize -= 2; localStorage.setItem('al_font', this.fontSize); this.applyFont(); }
        });
        document.getElementById('btn-font-inc')?.addEventListener('click', () => {
            if (this.fontSize < 22) { this.fontSize += 2; localStorage.setItem('al_font', this.fontSize); this.applyFont(); }
        });
    },

    // ── Utils ─────────────────────────────────────────────────────
    showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(id);
        if (target) { target.classList.add('active'); window.scrollTo(0, 0); }
    },
    toast(msg, type = 'info') {
        const t = document.createElement('div');
        t.className   = `toast toast-${type}`;
        t.textContent = msg;
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add('toast-show'));
        setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 350); }, 3200);
    },
    escapeHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    },
    _randomIndices(max, count) {
        const set = new Set();
        while (set.size < Math.min(count, max)) set.add(Math.floor(Math.random() * max));
        return [...set];
    },
    async _syncProgress(area, data) {
        if (!this.currentUser) return;
        try {
            await AuthService.saveProgress(this.currentUser.uid, area, data);
            if (!this.userData)          this.userData          = {};
            if (!this.userData.progress) this.userData.progress = {};
            this.userData.progress[area] = data;
        } catch (e) { console.warn('Sync error:', e); }
    },

    // ── Bind Auth ─────────────────────────────────────────────────
    bindAuth() {
        const btnAuth    = document.getElementById('btn-auth-action');
        const btnGoogle  = document.getElementById('btn-google');
        const toggleLink = document.getElementById('toggle-link');
        const btnLogout  = document.getElementById('btn-logout');

        toggleLink?.addEventListener('click', e => {
            e.preventDefault();
            this.isSignUp = !this.isSignUp;
            const iS = this.isSignUp;
            document.getElementById('auth-title').textContent  = iS ? 'Criar Conta' : 'Bem-vindo de volta';
            btnAuth.textContent = iS ? 'Criar Conta' : 'Entrar';
            document.getElementById('wrap-name').style.display = iS ? 'flex' : 'none';
            document.getElementById('toggle-msg').textContent  = iS ? 'Já tem uma conta?' : 'Não tem uma conta?';
            toggleLink.textContent = iS ? 'Faça login' : 'Cadastre-se';
        });

        btnAuth?.addEventListener('click', async () => {
            const email = document.getElementById('auth-email').value.trim();
            const pass  = document.getElementById('auth-pass').value;
            const name  = document.getElementById('reg-name').value.trim();
            if (!email || !pass) { this.toast('Preencha e-mail e senha', 'warn'); return; }
            btnAuth.disabled  = true;
            btnAuth.innerHTML = '<span class="btn-spin"></span> Aguardando...';
            try {
                if (this.isSignUp) await AuthService.signUp(email, pass, name);
                else               await AuthService.login(email, pass);
            } catch (err) {
                this.toast('Erro: ' + err.message, 'error');
                btnAuth.disabled    = false;
                btnAuth.textContent = this.isSignUp ? 'Criar Conta' : 'Entrar';
            }
        });

        btnGoogle?.addEventListener('click', async () => {
            try { await AuthService.loginWithGoogle(); }
            catch (err) { this.toast('Erro Google: ' + err.message, 'error'); }
        });

        btnLogout?.addEventListener('click', () => AuthService.logout());
    },

    // ── Bind Navegação ────────────────────────────────────────────
    bindNavEvents() {
        document.getElementById('btn-back')?.addEventListener('click', async () => {
            await this.loadDashboard(); this.showScreen('dashboard-screen');
        });
        document.getElementById('btn-next')?.addEventListener('click', () => this.nextQuestion());

        document.getElementById('ac-btn-ok')?.addEventListener('click', async () => {
            this.closeModal('area-complete-modal');
            await this.loadDashboard(); this.showScreen('dashboard-screen');
        });
        document.getElementById('allc-btn-ranking')?.addEventListener('click', () => {
            this.closeModal('all-complete-modal'); this.showRanking();
        });
        document.getElementById('allc-btn-dashboard')?.addEventListener('click', async () => {
            this.closeModal('all-complete-modal');
            await this.loadDashboard(); this.showScreen('dashboard-screen');
        });

        document.getElementById('btn-my-scores')?.addEventListener('click', () => this.showScores());
        document.getElementById('btn-ranking')?.addEventListener('click',   () => this.showRanking());
        document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
            const ok = await this.confirmReset(); if (ok) await this.doResetAll();
        });

        document.getElementById('btn-back-scores')?.addEventListener('click',  () => this.showScreen('dashboard-screen'));
        document.getElementById('btn-back-ranking')?.addEventListener('click', () => this.showScreen('dashboard-screen'));

        document.getElementById('share-close')?.addEventListener('click', () => this.closeModal('share-modal'));
    },

    // ── Bind Duelo ────────────────────────────────────────────────
    bindDuelEvents() {
        // Dashboard: botão de duelo
        document.getElementById('btn-duel')?.addEventListener('click', () => this.showDuelSetup());

        // Modal seleção de área do duelo
        this.AREAS.forEach(area => {
            document.getElementById(`duel-area-${area}`)?.addEventListener('click', () => this.createDuel(area));
        });
        document.getElementById('duel-setup-close')?.addEventListener('click', () => this.closeModal('duel-setup-modal'));

        // Lobby
        document.getElementById('lobby-copy-btn')?.addEventListener('click', () => {
            const link = document.getElementById('lobby-duel-link')?.value;
            if (link) {
                navigator.clipboard.writeText(link).then(() => this.toast('Link copiado!', 'info'));
            }
        });
        document.getElementById('lobby-start-btn')?.addEventListener('click', () => this.startDuelQuiz());
        document.getElementById('lobby-cancel-btn')?.addEventListener('click', () => this.cancelDuel());

        // Quiz do duelo
        document.getElementById('duel-btn-next')?.addEventListener('click', () => this.nextDuelQuestion());
        document.getElementById('duel-btn-back')?.addEventListener('click', () => this.cancelDuel());

        // Tela de aguardo
        document.getElementById('duel-waiting-cancel')?.addEventListener('click', () => this.cancelDuel());

        // Resultado do duelo
        document.getElementById('duel-res-share')?.addEventListener('click', () => {
            if (this._lastDuelResult) {
                this.showShareCard({
                    area:    this.duelData?.area || 'linguagens',
                    score:   this._lastDuelResult.myScore,
                    correct: this._lastDuelResult.myHits,
                    total:   this._lastDuelResult.total,
                    isDuel:  true,
                    duelData: this._lastDuelResult
                });
            }
        });
        document.getElementById('duel-res-home')?.addEventListener('click', async () => {
            await this.loadDashboard(); this.showScreen('dashboard-screen');
        });
        document.getElementById('duel-res-rematch')?.addEventListener('click', () => {
            if (this.duelData?.area) this.createDuel(this.duelData.area);
        });
    }
};

window.app = app;
app.init();

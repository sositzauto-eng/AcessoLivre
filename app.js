import { AuthService } from './auth.js';
import { questions }   from './questions.js';

/* ═══════════════════════════════════════════════════════════
   ACESSO LIVRE — app.js
════════════════════════════════════════════════════════════ */
const app = {

    // ── Estado Global ─────────────────────────────────────────────
    currentUser:      null,
    userData:         null,
    currentArea:      null,
    currentQuestions: [],
    currentIndex:     0,
    correctCount:     0,
    isSignUp:         false,
    fontSize:         parseInt(localStorage.getItem('al_font') || '16'),

    AREAS: ['linguagens', 'matematica', 'natureza', 'humanas'],

    AREA_META: {
        linguagens: { label: 'Linguagens',  icon: '📚', cls: 'lang' },
        matematica: { label: 'Matemática',  icon: '🔢', cls: 'math' },
        natureza:   { label: 'C. Natureza', icon: '🔬', cls: 'sci'  },
        humanas:    { label: 'C. Humanas',  icon: '🌍', cls: 'hum'  }
    },

    // ── Inicialização ─────────────────────────────────────────────
    init() {
        this.applyFont();
        this.bindFontControls();
        this.bindAuth();
        this.bindNavEvents();
        this.registerSW();

        AuthService.onAuthStateChanged(async user => {
            if (user) {
                this.currentUser = user;
                await this.loadDashboard();
                this.showScreen('dashboard-screen');
            } else {
                this.currentUser = null;
                this.userData    = null;
                this.showScreen('login-screen');
            }
        });
    },

    // ── Registrar Service Worker (PWA) ────────────────────────────
    registerSW() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(() => console.log('SW registrado ✓'))
                    .catch(err => console.warn('SW erro:', err));
            });
        }
    },

    // ── Extrair nome amigável do e-mail ───────────────────────────
    nomeDoEmail(email) {
        const prefix = (email || '').split('@')[0];
        return prefix
            .replace(/[._\-+]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, c => c.toUpperCase()) || 'Estudante';
    },

    // ── Carregar e Renderizar Dashboard ───────────────────────────
    async loadDashboard() {
        try {
            this.userData = await AuthService.loadUserData(this.currentUser.uid);

            // ── Resolve o nome correto ─────────────────────────────
            //  1. displayName do Google/Auth
            //  2. nome salvo no Firestore (se não for placeholder)
            //  3. prefixo do e-mail
            const savedNome  = this.userData?.nome;
            const isPlaceholder = !savedNome || savedNome === 'Usuário' || savedNome === 'Usuario';
            const resolvedName  =
                this.currentUser.displayName ||
                (isPlaceholder ? null : savedNome) ||
                this.nomeDoEmail(this.currentUser.email);

            // Corrige contas antigas que ficaram com "Usuário" no Firestore
            if (isPlaceholder) {
                await AuthService.updateUserName(this.currentUser.uid, resolvedName);
                if (this.userData) this.userData.nome = resolvedName;
            }

            const el = document.getElementById('user-name');
            if (el) el.textContent = resolvedName.split(' ')[0]; // primeiro nome

            this.renderDashboard();
        } catch (err) {
            console.error('Erro ao carregar dados:', err);
        }
    },

    renderDashboard() {
        const progress     = this.userData?.progress || {};
        const allCompleted = this.AREAS.every(a => progress[a]?.completed);

        this.AREAS.forEach(area => {
            const data  = progress[area] || { currentIndex: 0, correctCount: 0, completed: false, score: 0 };
            const total = questions[area]?.length || 45;
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
                card.classList.remove('card-locked-reset');
            } else if (data.completed && allCompleted) {
                if (labelEl) labelEl.textContent  = 'Refazer';
                if (lockEl)  lockEl.style.display  = 'none';
                if (btnEl) { btnEl.textContent = '↺ Refazer'; btnEl.disabled = false; }
                card.classList.remove('card-done');
                card.classList.add('card-locked-reset');
            } else if (data.currentIndex > 0) {
                if (labelEl) labelEl.textContent  = `${data.currentIndex}/${total} questões`;
                if (lockEl)  lockEl.style.display  = 'none';
                if (btnEl) { btnEl.textContent = '▶ Continuar'; btnEl.disabled = false; }
                card.classList.remove('card-done', 'card-locked-reset');
            } else {
                if (labelEl) labelEl.textContent  = `0/${total} questões`;
                if (lockEl)  lockEl.style.display  = 'none';
                if (btnEl) { btnEl.textContent = '→ Iniciar'; btnEl.disabled = false; }
                card.classList.remove('card-done', 'card-locked-reset');
            }
        });

        // Banner progresso geral
        const completedCount = this.AREAS.filter(a => progress[a]?.completed).length;
        const progressBanner = document.getElementById('overall-progress');
        if (progressBanner) {
            progressBanner.textContent = `${completedCount}/4 áreas concluídas`;
            progressBanner.className   = completedCount === 4 ? 'overall-complete' : 'overall-progress';
        }

        // Banner nota total
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

    // ── Iniciar / Retomar Quiz ─────────────────────────────────────
    async startQuiz(area) {
        if (!questions[area]?.length) {
            this.toast('Área não disponível ainda.', 'warn'); return;
        }

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
        this.currentQuestions = questions[area];

        const saved       = this.userData?.progress?.[area] || {};
        this.currentIndex = saved.completed ? 0 : (saved.currentIndex || 0);
        this.correctCount = saved.completed ? 0 : (saved.correctCount || 0);

        const meta    = this.AREA_META[area];
        const titleEl = document.getElementById('quiz-area-title');
        if (titleEl) titleEl.textContent = `${meta.icon} ${meta.label}`;

        const bar = document.getElementById('quiz-progress-bar');
        if (bar) bar.className = `quiz-bar-fill ${meta.cls}`;

        this.showScreen('quiz-screen');
        this.loadQuestion();
    },

    // ── Carregar Questão ──────────────────────────────────────────
    loadQuestion() {
        if (this.currentIndex >= this.currentQuestions.length) {
            this.finishQuiz(); return;
        }

        const q     = this.currentQuestions[this.currentIndex];
        const total = this.currentQuestions.length;

        const pct = Math.round((this.currentIndex / total) * 100);
        const bar = document.getElementById('quiz-progress-bar');
        if (bar) bar.style.width = pct + '%';

        const counter = document.getElementById('quiz-counter');
        if (counter) counter.textContent = `${this.currentIndex + 1} / ${total}`;

        const qText = document.getElementById('question-text');
        if (qText) qText.textContent = q.pergunta;

        const fbArea = document.getElementById('feedback-area');
        if (fbArea) fbArea.classList.add('hidden');

        const list = document.getElementById('options-list');
        list.innerHTML = '';

        Object.entries(q.alternativas).forEach(([letra, texto]) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerHTML =
                `<span class="opt-letter">${letra}</span>
                 <span class="opt-text">${texto}</span>`;
            btn.addEventListener('click', () => this.checkAnswer(letra, q, btn));
            list.appendChild(btn);
        });

        const quizScroll = document.getElementById('quiz-scroll');
        if (quizScroll) quizScroll.scrollTop = 0;
    },

    // ── Verificar Resposta ────────────────────────────────────────
    async checkAnswer(escolha, questao, botao) {
        document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

        const isCorrect = escolha === questao.correta;
        if (isCorrect) {
            botao.classList.add('opt-correct');
            this.correctCount++;
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
                const letter = b.querySelector('.opt-letter')?.textContent;
                if (letter === questao.correta) b.classList.add('opt-correct');
            });
        }

        document.getElementById('explanation-text').textContent = questao.explicacao.correta;
        document.getElementById('feedback-area').classList.remove('hidden');

        this._syncProgress(this.currentArea, {
            currentIndex: this.currentIndex + 1,
            correctCount: this.correctCount,
            completed:    false,
            score:        0
        });
    },

    // ── Próxima Questão ───────────────────────────────────────────
    nextQuestion() {
        this.currentIndex++;
        if (this.currentIndex < this.currentQuestions.length) {
            this.loadQuestion();
        } else {
            this.finishQuiz();
        }
    },

    // ── Concluir Área ─────────────────────────────────────────────
    async finishQuiz() {
        const total = this.currentQuestions.length;
        const score = this.calcScore(this.correctCount, total);

        const completedAreaData = {
            currentIndex: total,
            correctCount: this.correctCount,
            completed:    true,
            score
        };
        await this._syncProgress(this.currentArea, completedAreaData);

        if (!this.userData)          this.userData          = {};
        if (!this.userData.progress) this.userData.progress = {};
        this.userData.progress[this.currentArea] = completedAreaData;

        const allCompleted = this.AREAS.every(a => this.userData.progress[a]?.completed);

        if (allCompleted) {
            const totalScore = this.calcTotalScore();
            this.userData.totalScore   = totalScore;
            this.userData.allCompleted = true;

            try {
                await AuthService.saveScores(
                    this.currentUser.uid,
                    this.userData.progress,
                    totalScore
                );
            } catch (e) { console.warn(e); }

            this.showAllCompleteModal(totalScore);
        } else {
            this.showAreaCompleteModal(score, this.correctCount, total);
        }
    },

    // ── Modais de Conclusão ───────────────────────────────────────
    showAreaCompleteModal(score, correct, total) {
        const meta = this.AREA_META[this.currentArea];
        document.getElementById('ac-icon').textContent     = meta.icon;
        document.getElementById('ac-area').textContent     = meta.label;
        document.getElementById('ac-score').textContent    = score;
        document.getElementById('ac-fraction').textContent = `${correct} de ${total} corretas`;
        document.getElementById('ac-level').textContent    = this.getScoreLevel(score);
        document.getElementById('ac-ring').style.background =
            `conic-gradient(var(--brand-accent) ${Math.round(correct/total*360)}deg, #E2E8F0 0deg)`;

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

        document.getElementById('all-complete-modal').classList.remove('hidden');
        setTimeout(() => document.getElementById('all-complete-modal').classList.add('modal-in'), 10);
    },

    closeModal(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('modal-in');
        setTimeout(() => el.classList.add('hidden'), 280);
    },

    // ── Tela de Notas Pessoais ────────────────────────────────────
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
                const total    = questions[area]?.length || 45;
                if (scoreEl) scoreEl.textContent = `${answered}/${total}`;
                if (barEl)   barEl.style.width   = Math.round(answered / total * 100) + '%';
                row.classList.add('score-row-pending');
            }
        });

        const totalEl      = document.getElementById('scores-total');
        const allCompleted = this.AREAS.every(a => progress[a]?.completed);
        if (totalEl) totalEl.textContent = allCompleted ? (this.userData?.totalScore || '—') : '—';

        this.showScreen('scores-screen');
    },

    // ── Ranking Global ────────────────────────────────────────────
    async showRanking() {
        this.showScreen('ranking-screen');
        const list = document.getElementById('ranking-list');
        list.innerHTML = `<div class="ranking-loading"><span class="spinner"></span> Carregando ranking...</div>`;

        try {
            const users = await AuthService.getRanking();
            this.renderRanking(users);
        } catch (err) {
            list.innerHTML = `<div class="ranking-empty">Erro ao carregar o ranking. Tente novamente.</div>`;
        }
    },

    renderRanking(users) {
        const list   = document.getElementById('ranking-list');
        const uid    = this.currentUser?.uid;
        const medals = ['🥇', '🥈', '🥉'];

        if (!users?.length) {
            list.innerHTML = `<div class="ranking-empty">Nenhum usuário no ranking ainda.<br>Conclua o caderno para aparecer aqui! 🏆</div>`;
            return;
        }

        list.innerHTML = users.slice(0, 50).map((u, i) => {
            const isMe      = u.uid === uid;
            const pos       = i < 3 ? `<span class="rank-medal">${medals[i]}</span>` : `<span class="rank-pos">${i + 1}º</span>`;
            const badge     = u.allCompleted
                ? `<span class="rank-badge">Caderno Completo</span>`
                : `<span class="rank-badge-partial">${u.completedAreas}/4 áreas</span>`;
            const scoreText = u.allCompleted ? u.totalScore : (u.totalScore || '—');

            return `
            <div class="ranking-item ${isMe ? 'ranking-me' : ''} ${i < 3 ? `rank-top-${i+1}` : ''}">
                <div class="rank-left">
                    ${pos}
                    <div class="rank-info">
                        <span class="rank-name">${this.escapeHtml(u.nome)} ${isMe ? '<span class="rank-you">(você)</span>' : ''}</span>
                        ${badge}
                    </div>
                </div>
                <span class="rank-score">${scoreText}</span>
            </div>`;
        }).join('');
    },

    // ── Reset de Progresso ────────────────────────────────────────
    confirmReset() {
        return new Promise(resolve => {
            document.getElementById('confirm-modal').classList.remove('hidden');
            setTimeout(() => document.getElementById('confirm-modal').classList.add('modal-in'), 10);

            document.getElementById('confirm-yes').addEventListener('click', () => {
                this.closeModal('confirm-modal');
                resolve(true);
            }, { once: true });

            document.getElementById('confirm-no').addEventListener('click', () => {
                this.closeModal('confirm-modal');
                resolve(false);
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

    // ── Cálculos de Nota ──────────────────────────────────────────
    calcScore(correct, total) {
        if (!total) return 0;
        const ratio  = correct / total;
        const curved = Math.pow(ratio, 0.85);
        return Math.round(300 + curved * 650);
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
            if (this.fontSize > 13) {
                this.fontSize -= 2;
                localStorage.setItem('al_font', this.fontSize);
                this.applyFont();
            }
        });
        document.getElementById('btn-font-inc')?.addEventListener('click', () => {
            if (this.fontSize < 22) {
                this.fontSize += 2;
                localStorage.setItem('al_font', this.fontSize);
                this.applyFont();
            }
        });
    },

    // ── Auxiliares ────────────────────────────────────────────────
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
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
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

    // ── Bind de Eventos de Auth ───────────────────────────────────
    bindAuth() {
        const btnAuth    = document.getElementById('btn-auth-action');
        const btnGoogle  = document.getElementById('btn-google');
        const toggleLink = document.getElementById('toggle-link');
        const btnLogout  = document.getElementById('btn-logout');

        toggleLink?.addEventListener('click', e => {
            e.preventDefault();
            this.isSignUp = !this.isSignUp;
            const iS = this.isSignUp;
            document.getElementById('auth-title').textContent     = iS ? 'Criar Conta' : 'Bem-vindo de volta';
            btnAuth.textContent                                    = iS ? 'Criar Conta'  : 'Entrar';
            document.getElementById('wrap-name').style.display    = iS ? 'flex'          : 'none';
            document.getElementById('toggle-msg').textContent     = iS ? 'Já tem uma conta?' : 'Não tem uma conta?';
            toggleLink.textContent                                 = iS ? 'Faça login'   : 'Cadastre-se';
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

    // ── Bind de Eventos de Navegação ──────────────────────────────
    bindNavEvents() {
        document.getElementById('btn-back')?.addEventListener('click', async () => {
            await this.loadDashboard();
            this.showScreen('dashboard-screen');
        });
        document.getElementById('btn-next')?.addEventListener('click', () => this.nextQuestion());

        document.getElementById('ac-btn-ok')?.addEventListener('click', async () => {
            this.closeModal('area-complete-modal');
            await this.loadDashboard();
            this.showScreen('dashboard-screen');
        });

        document.getElementById('allc-btn-ranking')?.addEventListener('click', () => {
            this.closeModal('all-complete-modal');
            this.showRanking();
        });
        document.getElementById('allc-btn-dashboard')?.addEventListener('click', async () => {
            this.closeModal('all-complete-modal');
            await this.loadDashboard();
            this.showScreen('dashboard-screen');
        });

        document.getElementById('btn-my-scores')?.addEventListener('click', () => this.showScores());
        document.getElementById('btn-ranking')?.addEventListener('click',   () => this.showRanking());
        document.getElementById('btn-reset-all')?.addEventListener('click', async () => {
            const ok = await this.confirmReset();
            if (ok) await this.doResetAll();
        });

        document.getElementById('btn-back-scores')?.addEventListener('click',  () => this.showScreen('dashboard-screen'));
        document.getElementById('btn-back-ranking')?.addEventListener('click', () => this.showScreen('dashboard-screen'));
    }
};

window.app = app;
app.init();

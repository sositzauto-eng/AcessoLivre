import { AuthService } from './auth.js';
import { questions } from './questions.js';

const app = {
    isSignUp: false,
    currentQuestions: [],
    currentIndex: 0,

    init() {
        this.bindEvents();
        
        AuthService.onAuthStateChanged((user) => {
            if (user) {
                const name = user.displayName || user.email.split('@')[0];
                const nameDisplay = document.getElementById('user-name');
                if (nameDisplay) nameDisplay.textContent = name;
                this.showScreen('dashboard-screen');
            } else {
                this.showScreen('login-screen');
            }
        });
    },

    bindEvents() {
        const btnAuth    = document.getElementById('btn-auth-action');
        const btnGoogle  = document.getElementById('btn-google');
        const toggleLink = document.getElementById('toggle-link');
        const btnLogout  = document.getElementById('btn-logout');
        const btnBack    = document.getElementById('btn-back');
        const btnNext    = document.getElementById('btn-next');

        if (toggleLink) {
            toggleLink.onclick = (e) => {
                e.preventDefault();
                this.isSignUp = !this.isSignUp;
                document.getElementById('auth-title').textContent  = this.isSignUp ? "Criar Conta" : "Entrar";
                btnAuth.textContent = this.isSignUp ? "Cadastrar" : "Entrar";
                document.getElementById('reg-name').style.display  = this.isSignUp ? "block" : "none";
                document.getElementById('toggle-msg').textContent  = this.isSignUp ? "Já tem uma conta?" : "Não tem uma conta?";
                toggleLink.textContent = this.isSignUp ? "Entrar" : "Cadastre-se";
            };
        }

        if (btnAuth) {
            btnAuth.onclick = async () => {
                const email = document.getElementById('auth-email').value.trim();
                const pass  = document.getElementById('auth-pass').value;
                const name  = document.getElementById('reg-name').value.trim();

                if (!email || !pass) {
                    alert("Por favor, preencha e-mail e senha.");
                    return;
                }

                btnAuth.disabled = true;
                btnAuth.textContent = "Aguarde...";

                try {
                    if (this.isSignUp) {
                        await AuthService.signUp(email, pass, name);
                    } else {
                        await AuthService.login(email, pass);
                    }
                } catch (error) {
                    alert("Erro: " + error.message);
                    btnAuth.disabled = false;
                    btnAuth.textContent = this.isSignUp ? "Cadastrar" : "Entrar";
                }
            };
        }

        if (btnGoogle) {
            btnGoogle.onclick = async () => {
                try {
                    await AuthService.loginWithGoogle();
                } catch (error) {
                    alert("Erro Google: " + error.message);
                }
            };
        }

        if (btnLogout) {
            btnLogout.onclick = () => AuthService.logout();
        }

        if (btnBack) {
            btnBack.onclick = () => this.showScreen('dashboard-screen');
        }

        if (btnNext) {
            btnNext.onclick = () => this.nextQuestion();
        }
    },

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const target = document.getElementById(screenId);
        if (target) target.classList.add('active');
    },

    startQuiz(area) {
        if (!questions[area] || questions[area].length === 0) {
            alert("Área ainda não disponível!");
            return;
        }
        this.currentQuestions = questions[area];
        this.currentIndex = 0;
        this.showScreen('quiz-screen');
        this.loadQuestion();
    },

    loadQuestion() {
        const q = this.currentQuestions[this.currentIndex];
        document.getElementById('question-text').textContent = q.pergunta;
        document.getElementById('feedback-area').classList.add('hidden');

        const list = document.getElementById('options-list');
        list.innerHTML = '';

        const progress = ((this.currentIndex + 1) / this.currentQuestions.length) * 100;
        document.getElementById('quiz-progress-bar').style.width = progress + "%";
        document.getElementById('quiz-counter').textContent =
            `Questão ${this.currentIndex + 1} de ${this.currentQuestions.length}`;

        Object.entries(q.alternativas).forEach(([letra, texto]) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerHTML = `<strong>${letra})</strong> ${texto}`;
            btn.onclick = () => this.checkAnswer(letra, q, btn);
            list.appendChild(btn);
        });
    },

    checkAnswer(escolha, questao, botao) {
        document.querySelectorAll('.option-btn').forEach(b => b.disabled = true);
        const feedback = document.getElementById('feedback-area');
        feedback.classList.remove('hidden');

        if (escolha === questao.correta) {
            botao.classList.add('correct');
            document.getElementById('feedback-status').innerHTML = "<b style='color:#48bb78'>✅ Correto!</b>";
        } else {
            botao.classList.add('wrong');
            document.getElementById('feedback-status').innerHTML = "<b style='color:#f56565'>❌ Incorreto.</b>";
            document.querySelectorAll('.option-btn').forEach(b => {
                if (b.textContent.startsWith(questao.correta)) b.classList.add('correct');
            });
        }
        document.getElementById('explanation-text').textContent = questao.explicacao.correta;
    },

    nextQuestion() {
        this.currentIndex++;
        if (this.currentIndex < this.currentQuestions.length) {
            this.loadQuestion();
        } else {
            alert(`Simulado finalizado! Você respondeu ${this.currentQuestions.length} questões.`);
            this.showScreen('dashboard-screen');
        }
    }
};

window.app = app;
app.init();

import { 
    auth, db, provider, signInWithPopup, 
    createUserWithEmailAndPassword, signInWithEmailAndPassword, 
    signOut, onAuthStateChanged,
    doc, setDoc, getDoc, getDocs, collection, query, orderBy, updateDoc
} from './firebase-config.js';

const INITIAL_PROGRESS = {
    linguagens: { currentIndex: 0, correctCount: 0, completed: false, score: 0 },
    matematica:  { currentIndex: 0, correctCount: 0, completed: false, score: 0 },
    natureza:    { currentIndex: 0, correctCount: 0, completed: false, score: 0 },
    humanas:     { currentIndex: 0, correctCount: 0, completed: false, score: 0 }
};

export const AuthService = {
    auth,

    onAuthStateChanged(callback) {
        return onAuthStateChanged(auth, callback);
    },

    // ── LOGIN COM GOOGLE ──────────────────────────────────────────
    async loginWithGoogle() {
        try {
            const result = await signInWithPopup(auth, provider);
            const user   = result.user;
            const userRef  = doc(db, "usuarios", user.uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                await setDoc(userRef, {
                    nome: user.displayName || 'Usuário',
                    email: user.email,
                    criadoEm: new Date().toISOString(),
                    progress: { ...INITIAL_PROGRESS },
                    allCompleted: false,
                    totalScore: 0
                });
            }
            return user;
        } catch (error) {
            console.error("Erro Google Login:", error.code);
            throw error;
        }
    },

    // ── CADASTRO ─────────────────────────────────────────────────
    async signUp(email, password, name) {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const user = credential.user;
        await setDoc(doc(db, "usuarios", user.uid), {
            nome: name || 'Usuário',
            email,
            criadoEm: new Date().toISOString(),
            progress: { ...INITIAL_PROGRESS },
            allCompleted: false,
            totalScore: 0
        });
        return user;
    },

    // ── LOGIN ─────────────────────────────────────────────────────
    async login(email, password) {
        return await signInWithEmailAndPassword(auth, email, password);
    },

    // ── LOGOUT ───────────────────────────────────────────────────
    async logout() {
        return await signOut(auth);
    },

    // ── CARREGAR DADOS DO USUÁRIO ─────────────────────────────────
    async loadUserData(uid) {
        const userRef  = doc(db, "usuarios", uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) return null;

        const data = userSnap.data();

        // Migração: garante que o campo progress existe para contas antigas
        if (!data.progress) {
            await updateDoc(userRef, {
                progress: { ...INITIAL_PROGRESS },
                allCompleted: false,
                totalScore: 0
            });
            data.progress    = { ...INITIAL_PROGRESS };
            data.allCompleted = false;
            data.totalScore   = 0;
        }

        return data;
    },

    // ── SALVAR PROGRESSO DE UMA ÁREA ─────────────────────────────
    async saveProgress(uid, area, progressData) {
        const userRef = doc(db, "usuarios", uid);
        await updateDoc(userRef, {
            [`progress.${area}`]: progressData
        });
    },

    // ── SALVAR NOTAS FINAIS (CADERNO COMPLETO) ────────────────────
    async saveScores(uid, progressObj, totalScore) {
        const userRef = doc(db, "usuarios", uid);
        await updateDoc(userRef, {
            progress: progressObj,
            allCompleted: true,
            totalScore
        });
    },

    // ── REINICIAR TODO O PROGRESSO ────────────────────────────────
    async resetProgress(uid) {
        const userRef = doc(db, "usuarios", uid);
        await updateDoc(userRef, {
            progress: { ...INITIAL_PROGRESS },
            allCompleted: false,
            totalScore: 0
        });
    },

    // ── RANKING GLOBAL ────────────────────────────────────────────
    async getRanking() {
        const snap  = await getDocs(query(collection(db, "usuarios")));
        const users = [];

        snap.forEach(d => {
            const data = d.data();
            const areas = ['linguagens', 'matematica', 'natureza', 'humanas'];
            const completedAreas = areas.filter(a => data.progress?.[a]?.completed).length;

            users.push({
                uid:            d.id,
                nome:           data.nome || 'Usuário',
                totalScore:     data.totalScore || 0,
                allCompleted:   data.allCompleted || false,
                completedAreas
            });
        });

        // Ordena: quem concluiu tudo primeiro, depois por nota, depois por áreas concluídas
        users.sort((a, b) => {
            if (b.allCompleted !== a.allCompleted) return b.allCompleted - a.allCompleted;
            if (b.totalScore   !== a.totalScore)   return b.totalScore   - a.totalScore;
            return b.completedAreas - a.completedAreas;
        });

        return users;
    }
};

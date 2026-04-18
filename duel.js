/* ═══════════════════════════════════════════════════════════
   ACESSO LIVRE — duel.js
   Serviço de Duelo 1v1 via Firestore em tempo real
════════════════════════════════════════════════════════════ */

import {
    db,
    doc, addDoc, getDoc, updateDoc,
    collection, onSnapshot, serverTimestamp
} from './firebase-config.js';

export const DuelService = {

    // ── Criar Duelo ───────────────────────────────────────────────
    async create(creatorId, creatorName, area, questionIndices) {
        const ref = await addDoc(collection(db, 'duelos'), {
            area,
            questionIndices,
            creatorId,
            status:    'aguardando',       // aguardando | em_andamento | finalizado
            criadoEm:  serverTimestamp(),
            jogadores: {
                [creatorId]: {
                    nome:      creatorName,
                    respostas: {},
                    acertos:   0,
                    score:     0,
                    terminado: false
                }
            }
        });
        return ref.id;
    },

    // ── Entrar no Duelo ───────────────────────────────────────────
    async join(duelId, uid, nome) {
        const ref  = doc(db, 'duelos', duelId);
        const snap = await getDoc(ref);

        if (!snap.exists())
            throw new Error('Duelo não encontrado. O link pode estar expirado.');

        const data = snap.data();

        if (data.status === 'finalizado')
            throw new Error('Este duelo já foi finalizado.');

        if (Object.keys(data.jogadores).length >= 2) {
            // Permite re-entrada do mesmo usuário (ex: reload de página)
            if (!data.jogadores[uid])
                throw new Error('Este duelo já está cheio.');
            return data;
        }

        if (data.creatorId === uid)
            throw new Error('Você já está neste duelo como criador.');

        await updateDoc(ref, {
            status: 'em_andamento',
            [`jogadores.${uid}`]: {
                nome,
                respostas: {},
                acertos:   0,
                score:     0,
                terminado: false
            }
        });

        return { ...data, id: duelId };
    },

    // ── Salvar Resposta ───────────────────────────────────────────
    async saveAnswer(duelId, uid, questionIdx, answer) {
        await updateDoc(doc(db, 'duelos', duelId), {
            [`jogadores.${uid}.respostas.${questionIdx}`]: answer
        });
    },

    // ── Finalizar partida de um jogador ───────────────────────────
    async finish(duelId, uid, acertos, score) {
        const ref  = doc(db, 'duelos', duelId);
        const snap = await getDoc(ref);
        const data = snap.data();

        // Verifica se o outro jogador já terminou
        const otherUid  = Object.keys(data.jogadores).find(k => k !== uid);
        const otherDone = otherUid ? data.jogadores[otherUid]?.terminado : false;

        await updateDoc(ref, {
            [`jogadores.${uid}.terminado`]: true,
            [`jogadores.${uid}.acertos`]:   acertos,
            [`jogadores.${uid}.score`]:     score,
            ...(otherDone ? { status: 'finalizado' } : {})
        });
    },

    // ── Buscar Duelo ──────────────────────────────────────────────
    async get(duelId) {
        const snap = await getDoc(doc(db, 'duelos', duelId));
        if (!snap.exists()) return null;
        return { id: snap.id, ...snap.data() };
    },

    // ── Listener em Tempo Real ────────────────────────────────────
    listen(duelId, callback) {
        return onSnapshot(doc(db, 'duelos', duelId), snap => {
            if (snap.exists()) callback({ id: snap.id, ...snap.data() });
        });
    }
};

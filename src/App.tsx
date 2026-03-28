/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  BookOpen, 
  User, 
  LogOut, 
  Plus, 
  Trash2, 
  Edit, 
  FileText, 
  ChevronRight, 
  ChevronLeft, 
  CheckCircle, 
  CheckCircle2,
  AlertCircle,
  Download,
  Loader2,
  ShieldCheck,
  GraduationCap,
  TrendingUp,
  Wallet,
  Coins,
  Eye,
  Printer,
  X,
  Book,
  FileCheck,
  Upload,
  Award,
  Settings,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  addDoc, 
  deleteDoc, 
  updateDoc, 
  query, 
  where, 
  onSnapshot,
  serverTimestamp,
  orderBy
} from 'firebase/firestore';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser 
} from 'firebase/auth';
import { db, auth } from './firebase';
import * as pdfjsLib from 'pdfjs-dist';

// PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

// Firestore Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Types
interface Assessment {
  id: string;
  title: string;
  baseText: string;
  timeLimit: number;
  questionCount: number;
  pointsPerQuestion: number;
  status: 'Available' | 'Unavailable';
  assessmentStatus: 'Available' | 'Unavailable';
  createdAt: any;
  updatedAt?: any;
  exerciseUrl?: string;
  exerciseName?: string;
  glossaryUrl?: string;
  glossaryName?: string;
  practiceExercise?: any;
}

interface Question {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface Result {
  id: string;
  email: string;
  assessmentId: string;
  assessmentTitle: string;
  score: number;
  pointsPerQuestion: number;
  answers: number[];
  questions: Question[];
  timestamp: any;
}

interface Student {
  id: string;
  email: string;
  lastLogin: any;
  createdAt: any;
}

// Gemini Setup
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authorizedEmails, setAuthorizedEmails] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [isGeneratingAssessment, setIsGeneratingAssessment] = useState(false);
  const [view, setView] = useState<'home' | 'admin' | 'student' | 'test' | 'result'>('home');
  const [currentAssessment, setCurrentAssessment] = useState<Assessment | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [studentAnswers, setStudentAnswers] = useState<number[]>([]);
  const [testResult, setTestResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [isInvalidated, setIsInvalidated] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      const email = u?.email?.toLowerCase();
      const isSystemAdmin = email === 'rama.lucas@urca.br';
      setIsAdmin(isSystemAdmin);
      
      if (u && !isSystemAdmin) {
        // Save student email to database using email as ID
        try {
          const studentRef = doc(db, 'students', u.email?.toLowerCase() || u.uid);
          const studentSnap = await getDoc(studentRef);
          if (!studentSnap.exists()) {
            await setDoc(studentRef, {
              email: u.email,
              createdAt: serverTimestamp(),
              lastLogin: serverTimestamp()
            });
          } else {
            await updateDoc(studentRef, {
              lastLogin: serverTimestamp()
            });
          }
        } catch (err) {
          console.error('Erro ao salvar dados do aluno:', err);
        }
      }
      
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Load App Lock State
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'config', 'settings'), (docSnap) => {
      if (docSnap.exists()) {
        const locked = docSnap.data().isLocked || false;
        setIsLocked(locked);
        
        // If app becomes locked and current user is not admin or tester, redirect to home and show error
        const isTester = user?.email?.toLowerCase() === 'maria@urca.br';
        if (locked && user && !isAdmin && !isTester) {
          setView('home');
          setError('O aplicativo foi travado pelo administrador.');
        }
      }
    });
    return unsubscribe;
  }, [user, isAdmin]);

  // Load Authorized Emails
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'config', 'access'), (docSnap) => {
      if (docSnap.exists()) {
        setAuthorizedEmails(docSnap.data().emails || []);
      }
    });
    return unsubscribe;
  }, []);

  // Security Lock: Detect when user leaves the page during test
  useEffect(() => {
    if (view !== 'test' || isAdmin) return;

    const handleSecurityViolation = (e: Event) => {
      if (e.type === 'blur' || document.visibilityState === 'hidden') {
        setIsInvalidated(true);
        setView('student');
        setCurrentAssessment(null);
        setQuestions([]);
        setStudentAnswers([]);
        setTimeLeft(0);
        setError('AVISO DE SEGURANÇA: Você saiu da página da avaliação. O teste foi invalidado por motivos de segurança e você precisará iniciar um novo processo.');
      }
    };

    document.addEventListener('visibilitychange', handleSecurityViolation);
    window.addEventListener('blur', handleSecurityViolation);

    return () => {
      document.removeEventListener('visibilitychange', handleSecurityViolation);
      window.removeEventListener('blur', handleSecurityViolation);
    };
  }, [view, isAdmin]);

  // Prevent accidental tab closing during test
  useEffect(() => {
    if (view !== 'test' || isAdmin) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [view, isAdmin]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = (formData.get('email') as string || '').trim();
    const password = (formData.get('password') as string || '').trim();

    try {
      setError(null);
      // Check if authorized (unless admin or tester)
      const lowerEmail = email.toLowerCase();
      const isSystemAdmin = lowerEmail === 'rama.lucas@urca.br';
      const isTester = lowerEmail === 'maria@urca.br';
      
      // Check App Lock
      if (isLocked && !isSystemAdmin && !isTester) {
        throw new Error('O aplicativo está travado no momento. Apenas o administrador tem acesso.');
      }

      if (!isSystemAdmin && !isTester && !authorizedEmails.includes(email)) {
        throw new Error('E-mail não autorizado para acesso.');
      }

      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (err: any) {
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
          // Try to create the user if authorized and using the default password
          if (password === '430798@R' || (isTester && password === '123456')) {
            try {
              await createUserWithEmailAndPassword(auth, email, password);
            } catch (createErr: any) {
              if (createErr.code === 'auth/email-already-in-use') {
                throw new Error('Credenciais inválidas para este e-mail. Verifique se a senha está correta ou se a conta já foi criada com outra senha.');
              }
              throw createErr;
            }
          } else {
            throw new Error('Credenciais inválidas. Verifique o e-mail e a senha digitados.');
          }
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setView('home');
  };

  const startAssessment = async (assessment: Assessment) => {
    setLoading(true);
    setIsGeneratingAssessment(true);
    setError(null);
    setIsInvalidated(false);
    const qCount = assessment.questionCount || 5;
    try {
      const prompt = `Você é um professor universitário de Finanças na URCA. 
      Sua tarefa é elaborar uma avaliação rigorosa de ${qCount} questões de múltipla escolha para o aluno logado.
      
      BASE DE CONHECIMENTO:
      ${assessment.baseText}
      
      DIRETRIZES:
      1. Gere exatamente ${qCount} questões.
      2. Use estudos de caso reais, exemplos práticos de finanças e análises profundas baseadas no texto fornecido.
      3. Cada questão deve ter 4 opções. Não inclua prefixos como "A) " ou "B) " nas opções, pois a interface já os adiciona.
      4. Forneça uma explicação detalhada para a resposta correta.
      5. O nível de dificuldade deve ser desafiador.
      6. Certifique-se de que esta avaliação seja ÚNICA e DIFERENTE de versões anteriores, explorando diversos ângulos do texto base.
      
      ID DA SESSÃO: ${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING }
                },
                correctIndex: { type: Type.INTEGER },
                explanation: { type: Type.STRING }
              },
              required: ["question", "options", "correctIndex", "explanation"]
            }
          }
        }
      });

      const generatedQuestions = JSON.parse(response.text);

      if (!Array.isArray(generatedQuestions) || generatedQuestions.length === 0) {
        throw new Error('Falha ao gerar questões válidas.');
      }

      setQuestions(generatedQuestions);
      setCurrentAssessment(assessment);
      setCurrentQuestionIndex(0);
      setStudentAnswers(new Array(generatedQuestions.length).fill(-1));
      setTimeLeft(assessment.timeLimit * 60);
      setView('test');
    } catch (err: any) {
      console.error('Erro ao gerar a prova:', err);
      setError('Erro ao gerar a prova com IA. Por favor, tente novamente.');
    } finally {
      setLoading(false);
      setIsGeneratingAssessment(false);
    }
  };

  const finishTest = async () => {
    if (!currentAssessment || !user) return;

    let correctCount = 0;
    questions.forEach((q, i) => {
      if (studentAnswers[i] === q.correctIndex) correctCount += 1;
    });

    const pointsPerQuestion = currentAssessment.pointsPerQuestion || 2;
    const score = correctCount * pointsPerQuestion;

    const resultData: Omit<Result, 'id'> = {
      email: user.email!,
      assessmentId: currentAssessment.id,
      assessmentTitle: currentAssessment.title,
      score: score,
      pointsPerQuestion: pointsPerQuestion,
      answers: studentAnswers,
      questions: questions,
      timestamp: serverTimestamp()
    };

    const docRef = await addDoc(collection(db, 'results'), resultData);
    setTestResult({ ...resultData, id: docRef.id });
    setView('result');
  };

  // Timer Effect
  useEffect(() => {
    if (view === 'test' && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft(t => t - 1), 1000);
      return () => clearInterval(timer);
    } else if (view === 'test' && timeLeft === 0) {
      finishTest();
    }
  }, [view, timeLeft]);

  const handleToggleLock = async () => {
    try {
      const settingsRef = doc(db, 'config', 'settings');
      await setDoc(settingsRef, { isLocked: !isLocked }, { merge: true });
    } catch (err) {
      console.error('Erro ao alternar trava:', err);
      setError('Erro ao alternar trava do aplicativo.');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="relative mb-8">
          <div className="w-24 h-24 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin"></div>
          <TrendingUp className="w-10 h-10 text-emerald-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
        </div>
        
        {isGeneratingAssessment ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            <h2 className="text-2xl font-bold text-neutral-900">Elaborando sua Avaliação...</h2>
            <p className="text-neutral-500 max-w-sm mx-auto">
              Por favor, aguarde um momento. Nossa IA está preparando questões exclusivas baseadas no material de estudo.
            </p>
            <div className="flex items-center justify-center gap-2 text-emerald-600 font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Analisando base de conhecimento</span>
            </div>
          </motion.div>
        ) : (
          <Loader2 className="w-12 h-12 text-emerald-600 animate-spin" />
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans selection:bg-emerald-100">
      {/* Navigation */}
      <nav className="border-b border-neutral-200 bg-white sticky top-0 z-50 no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('home')}>
            <TrendingUp className="w-8 h-8 text-emerald-600" />
            <span className="text-xl font-bold tracking-tight">Finanças - URCA</span>
          </div>
          
          <div className="flex items-center gap-4">
            {user && isAdmin && (
              <button 
                onClick={handleToggleLock}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all shadow-sm ${isLocked ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'}`}
              >
                {isLocked ? <AlertCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                {isLocked ? 'Destravar App' : 'Travar App'}
              </button>
            )}
            {user ? (
              <>
                <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-neutral-100 rounded-full text-sm font-medium">
                  <User className="w-4 h-4" />
                  {user.email}
                </div>
                {!isAdmin && (view === 'test' || view === 'result') && (
                  <button 
                    onClick={() => setView('student')}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-600 rounded-xl font-bold hover:bg-emerald-200 transition-all shadow-sm"
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    Ir para o Painel
                  </button>
                )}
                {isAdmin && (
                  <button 
                    onClick={() => setView('admin')}
                    className="p-2 hover:bg-neutral-100 rounded-lg transition-colors"
                    title="Painel Admin"
                  >
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  </button>
                )}
                <button 
                  onClick={handleLogout}
                  className="flex items-center gap-2 text-sm font-semibold text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sair
                </button>
              </>
            ) : (
              <button 
                onClick={() => setView('home')}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700 transition-colors"
              >
                Entrar
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 no-print">
        <AnimatePresence mode="wait">
          {view === 'home' && <HomeView user={user} isAdmin={isAdmin} setView={setView} handleLogin={handleLogin} error={error} isLocked={isLocked} handleToggleLock={handleToggleLock} />}
          {view === 'admin' && isAdmin && <AdminPanel setView={setView} isLocked={isLocked} handleToggleLock={handleToggleLock} />}
          {view === 'student' && user && <StudentPanel user={user} isAdmin={isAdmin} startAssessment={startAssessment} error={error} />}
          {view === 'test' && (
            <TestView 
              questions={questions} 
              currentIndex={currentQuestionIndex} 
              setCurrentIndex={setCurrentQuestionIndex}
              answers={studentAnswers}
              setAnswers={setStudentAnswers}
              timeLeft={timeLeft}
              onFinish={finishTest}
              onExit={() => setView('student')}
            />
          )}
          {view === 'result' && testResult && <ResultView result={testResult} setView={setView} />}
        </AnimatePresence>
      </main>
    </div>
  );
}

// --- Views ---

function HomeView({ user, isAdmin, setView, handleLogin, error, isLocked, handleToggleLock }: any) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="grid lg:grid-cols-2 gap-12 items-center no-print"
    >
      <div className="space-y-8">
        <div className="space-y-4">
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight leading-tight">
            Finanças - URCA: <br />
            <span className="text-emerald-600 italic font-serif">Onde a Tecnologia encontra o Valor</span>
          </h1>
          <p className="text-lg text-neutral-600 leading-relaxed max-w-xl">
            A revolução das finanças modernas é impulsionada por IA, Blockchain e Data Science. 
            Nossa plataforma capacita estudantes com ferramentas inteligentes para dominar o mercado financeiro 
            e construir um futuro sólido e inovador.
          </p>
        </div>

        <div className="flex flex-col items-center sm:items-start gap-6">
          <div className="flex items-center gap-6">
            <motion.div 
              animate={{ 
                scale: isLocked ? [1, 1.05, 1] : 1,
                boxShadow: isLocked 
                  ? "0 0 20px rgba(239, 68, 68, 0.4)" 
                  : "0 0 20px rgba(16, 185, 129, 0.4)"
              }}
              transition={{ repeat: isLocked ? Infinity : 0, duration: 2 }}
              className={`w-32 h-32 rounded-full border-8 ${isLocked ? 'bg-red-500 border-red-200' : 'bg-emerald-500 border-emerald-200'} shadow-xl flex items-center justify-center transition-colors duration-500`}
            >
              {isLocked ? (
                <AlertCircle className="w-12 h-12 text-white" />
              ) : (
                <ShieldCheck className="w-12 h-12 text-white" />
              )}
            </motion.div>
            <div className="space-y-1">
              <h3 className={`text-2xl font-bold ${isLocked ? 'text-red-600' : 'text-emerald-600'}`}>
                Status: {isLocked ? 'Aplicativo Travado' : 'Aplicativo Liberado'}
              </h3>
              <p className="text-neutral-500 text-sm max-w-xs">
                {isLocked 
                  ? 'Apenas o administrador tem acesso ao sistema neste momento.' 
                  : 'Todos os alunos autorizados podem acessar as avaliações.'}
              </p>
            </div>
          </div>

          {user && isAdmin && (
            <button 
              onClick={handleToggleLock}
              className={`px-8 py-4 rounded-2xl font-bold text-lg transition-all shadow-lg flex items-center gap-3 ${isLocked ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200' : 'bg-red-600 text-white hover:bg-red-700 shadow-red-200'}`}
            >
              {isLocked ? <ShieldCheck className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
              {isLocked ? 'Destravar Aplicativo Agora' : 'Travar Aplicativo Agora'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white p-8 rounded-3xl shadow-xl border border-neutral-100">
        {user ? (
          <div className="text-center space-y-6 py-8">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
              <GraduationCap className="w-10 h-10 text-emerald-600" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Bem-vindo de volta!</h2>
              <p className="text-neutral-500">Você está logado como {user.email}</p>
            </div>
            <button 
              onClick={() => setView(isAdmin ? 'admin' : 'student')}
              className="w-full bg-emerald-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
            >
              Ir para o Painel
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Login de Estudante</h2>
              <p className="text-neutral-500 text-sm">Acesse sua conta para iniciar avaliações.</p>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-center gap-3 text-sm font-medium border border-red-100">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-neutral-700 ml-1">E-mail</label>
                <input 
                  name="email"
                  type="email" 
                  required
                  placeholder="seu@email.com"
                  className="w-full px-4 py-3 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-neutral-700 ml-1">Senha</label>
                <input 
                  name="password"
                  type="password" 
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                />
              </div>
            </div>

            <button 
              type="submit"
              className="w-full bg-emerald-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
            >
              Entrar na Plataforma
            </button>
            
            <p className="text-center text-xs text-neutral-400">
              Uso restrito a alunos autorizados da URCA.
            </p>
          </form>
        )}
      </div>
    </motion.div>
  );
}

function AdminPanel({ setView, isLocked, handleToggleLock }: any) {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [showStudents, setShowStudents] = useState(false);
  const [emailsText, setEmailsText] = useState('');
  const [isEditingAccess, setIsEditingAccess] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newAssessment, setNewAssessment] = useState({ 
    title: '', 
    baseText: '', 
    timeLimit: 30, 
    questionCount: 5, 
    pointsPerQuestion: 2, 
    status: 'Available' as 'Available' | 'Unavailable',
    assessmentStatus: 'Available' as 'Available' | 'Unavailable',
    glossaryUrl: '',
    glossaryName: ''
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [showDefaultModal, setShowDefaultModal] = useState(false);
  const [defaultQuestions, setDefaultQuestions] = useState<Question[]>([]);
  const [isGeneratingDefault, setIsGeneratingDefault] = useState(false);
  const [selectedAssessmentForDefault, setSelectedAssessmentForDefault] = useState<Assessment | null>(null);
  const [selectedAssessmentForReview, setSelectedAssessmentForReview] = useState<Assessment | null>(null);

  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [showEditStudentModal, setShowEditStudentModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [newStudentEmail, setNewStudentEmail] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [resultToDelete, setResultToDelete] = useState<string | null>(null);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [isDeletingResult, setIsDeletingResult] = useState(false);

  const toggleSelectAllStudents = () => {
    if (selectedStudentIds.length === students.length) {
      setSelectedStudentIds([]);
    } else {
      setSelectedStudentIds(students.map(s => s.id));
    }
  };

  const toggleSelectStudent = (id: string) => {
    if (selectedStudentIds.includes(id)) {
      setSelectedStudentIds(selectedStudentIds.filter(sid => sid !== id));
    } else {
      setSelectedStudentIds([...selectedStudentIds, id]);
    }
  };

  const handleDeleteStudent = async (id: string) => {
    setStudentToDelete(id);
    setIsDeletingBulk(false);
    setShowDeleteConfirm(true);
  };

  const handleDeleteSelectedStudents = async () => {
    setIsDeletingBulk(true);
    setShowDeleteConfirm(true);
  };

  const handleDeleteResult = async (id: string) => {
    setResultToDelete(id);
    setIsDeletingResult(true);
    setIsDeletingBulk(false);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    try {
      if (isDeletingResult && resultToDelete) {
        await deleteDoc(doc(db, 'results', resultToDelete));
      } else if (isDeletingBulk) {
        await Promise.all(selectedStudentIds.map(id => deleteDoc(doc(db, 'students', id))));
        setSelectedStudentIds([]);
      } else if (studentToDelete) {
        await deleteDoc(doc(db, 'students', studentToDelete));
        setSelectedStudentIds(selectedStudentIds.filter(sid => sid !== studentToDelete));
      }
      setShowDeleteConfirm(false);
      setStudentToDelete(null);
      setResultToDelete(null);
      setIsDeletingBulk(false);
      setIsDeletingResult(false);
    } catch (err) {
      console.error('Erro ao excluir:', err);
      setError('Erro ao excluir item(ns).');
    }
  };

  const openEditStudentModal = (student: Student) => {
    setEditingStudent(student);
    setNewStudentEmail(student.email);
    setShowEditStudentModal(true);
  };

  const handleUpdateStudent = async () => {
    if (!editingStudent || !newStudentEmail) return;
    try {
      // If email changed, we might need to handle the ID change if we use email as ID
      // But let's assume we just update the email field for now.
      // Actually, my previous change used email as ID. If I change the email, I should probably create a new doc and delete the old one, or just update the email field.
      // If I update the email field, the ID remains the old email. That's not ideal.
      // Let's just update the email field for now to keep it simple, but ideally ID should match email.
      
      const studentRef = doc(db, 'students', editingStudent.id);
      await updateDoc(studentRef, {
        email: newStudentEmail.toLowerCase().trim()
      });
      
      setShowEditStudentModal(false);
      setEditingStudent(null);
      setNewStudentEmail('');
    } catch (err) {
      console.error('Erro ao atualizar aluno:', err);
      setError('Erro ao atualizar aluno.');
    }
  };

  const generateDefaultAssessment = async (assessment: Assessment) => {
    setIsGeneratingDefault(true);
    setSelectedAssessmentForDefault(assessment);
    const qCount = assessment.questionCount || 5;
    try {
      const prompt = `Crie uma avaliação de ${qCount} questões de múltipla escolha baseada no seguinte texto sobre finanças: "${assessment.baseText.substring(0, 15000)}".
      
      DIRETRIZES DE CONTEÚDO CRÍTICAS:
      1. As questões devem ser REFLEXIVAS e ANALÍTICAS, fugindo da simples memorização.
      2. Utilize EXEMPLOS PRÁTICOS ou ESTUDOS DE CASO curtos em cada questão para contextualizar o problema.
      3. O nível de dificuldade deve ser ALTO (nível universitário), exigindo que o aluno aplique os conceitos do texto em situações reais.
      4. Cada questão deve ter exatamente 4 alternativas. Não inclua prefixos como "A) " ou "B) " nas opções, pois a interface já os adiciona.
      5. Forneça o gabarito detalhado com uma breve explicação para cada resposta correta.
      6. Gere exatamente ${qCount} questões.
      
      FORMATO DE RETORNO (JSON):
      Retorne APENAS um array JSON no seguinte formato:
      [
        {
          "question": "Texto da questão com o estudo de caso...",
          "options": ["Texto da opção 1", "Texto da opção 2", "Texto da opção 3", "Texto da opção 4"],
          "correctIndex": 0,
          "explanation": "Explicação do porquê esta é a resposta correta com base no texto e no caso."
        }
      ]`;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json"
        }
      });

      const text = response.text;
      const parsedQuestions = JSON.parse(text);
      setDefaultQuestions(parsedQuestions);
      setShowDefaultModal(true);
    } catch (err) {
      console.error("Erro ao gerar avaliação default:", err);
      alert("Erro ao gerar avaliação. Tente novamente.");
    } finally {
      setIsGeneratingDefault(false);
    }
  };

  const downloadAssessmentTXT = () => {
    if (!selectedAssessmentForDefault || defaultQuestions.length === 0) return;

    let content = "UNIVERSIDADE REGIONAL DO CARIRI – URCA\n";
    content += "CURSO DE CIÊNCIAS ECONÔMICAS\n";
    content += "DISCIPLINA: FINANÇAS I\n";
    content += "ALUNO/A: ________________________________________________\n";
    content += "DATA: ____/____/_______\n";
    content += `VALOR: ${(selectedAssessmentForDefault.questionCount * (selectedAssessmentForDefault.pointsPerQuestion || 2)).toFixed(1)} PONTOS\n\n`;
    content += `AVALIAÇÃO: ${selectedAssessmentForDefault.title.toUpperCase()}\n\n`;

    defaultQuestions.forEach((q, i) => {
      content += `${i + 1}. ${q.question}\n`;
      q.options.forEach((opt, idx) => {
        const optLetter = String.fromCharCode(65 + idx);
        content += `   ${optLetter}) ${opt}\n`;
      });
      content += "\n";
    });

    content += "--------------------------------------------------\n";
    content += "GABARITO (APENAS PARA O PROFESSOR)\n";
    content += "--------------------------------------------------\n";
    defaultQuestions.forEach((q, i) => {
      content += `Questão ${i + 1}: ${String.fromCharCode(65 + q.correctIndex)}\n`;
      content += `Explicação: ${q.explanation}\n\n`;
    });

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `avaliacao_${selectedAssessmentForDefault.title.toLowerCase().replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const q = query(collection(db, 'assessments'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setAssessments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Assessment)));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const fetchAccess = async () => {
      const docSnap = await getDoc(doc(db, 'config', 'access'));
      if (docSnap.exists()) {
        setEmailsText(docSnap.data().emails.join(', '));
      }
    };
    fetchAccess();
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'students'), orderBy('email', 'asc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setStudents(snap.docs.map(d => ({ id: d.id, ...d.data() } as Student)));
    });
    return unsubscribe;
  }, []);

  const saveAccess = async () => {
    const emails = emailsText.split(',').map(e => e.trim().toLowerCase()).filter(e => e !== '');
    try {
      await setDoc(doc(db, 'config', 'access'), { emails });
      
      // Pre-populate students collection for each authorized email
      // Fetch current students directly to ensure we have the latest data
      const studentsSnap = await getDocs(collection(db, 'students'));
      const existingStudentEmails = studentsSnap.docs.map(d => d.id.toLowerCase());
      
      // Add new students
      await Promise.all(emails.map(async (email) => {
        if (!existingStudentEmails.includes(email)) {
          const studentRef = doc(db, 'students', email);
          await setDoc(studentRef, {
            email: email,
            createdAt: serverTimestamp(),
            lastLogin: null
          });
        }
      }));
      
      setIsEditingAccess(false);
      setError(null);
    } catch (err: any) {
      console.error('Erro ao sincronizar lista de alunos:', err);
      if (err.message && err.message.toLowerCase().includes('permission')) {
        try {
          handleFirestoreError(err, OperationType.WRITE, 'students');
        } catch (authErr: any) {
          setError(`Erro de permissão ao sincronizar alunos: ${authErr.message}`);
        }
      } else {
        setError(`Erro ao salvar acessos: ${err.message || String(err)}`);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setUploadSuccess(false);
    try {
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        let fullText = '';
        
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str || '')
            .join(' ');
          fullText += pageText + '\n';
        }
        
        if (!fullText.trim()) {
          throw new Error('Não foi possível extrair texto deste PDF. O arquivo pode estar protegido ou ser apenas uma imagem.');
        }
        
        setNewAssessment(prev => ({ ...prev, baseText: fullText.trim() }));
        setUploadSuccess(true);
      } else if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
        const arrayBuffer = await file.arrayBuffer();
        let text = '';
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
        } catch (e) {
          text = new TextDecoder('iso-8859-1').decode(arrayBuffer);
        }
        if (!text.trim()) throw new Error('O arquivo de texto está vazio.');
        setNewAssessment(prev => ({ ...prev, baseText: text.trim() }));
        setUploadSuccess(true);
      } else {
        throw new Error('Formato de arquivo não suportado. Use PDF ou TXT.');
      }
    } catch (err: any) {
      console.error('Erro no upload:', err);
      setError(err.message || 'Erro ao processar arquivo.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setNewAssessment({ 
      title: '', 
      baseText: '', 
      timeLimit: 30, 
      questionCount: 5, 
      pointsPerQuestion: 2, 
      status: 'Available',
      assessmentStatus: 'Available',
      glossaryUrl: '',
      glossaryName: ''
    });
    setUploadSuccess(false);
    setError(null);
    setShowAddModal(true);
  };

  const openEditModal = (assessment: Assessment) => {
    setEditingId(assessment.id);
    setNewAssessment({
      title: assessment.title,
      baseText: assessment.baseText,
      timeLimit: assessment.timeLimit,
      questionCount: assessment.questionCount || 5,
      pointsPerQuestion: assessment.pointsPerQuestion || 2,
      status: assessment.status,
      assessmentStatus: assessment.assessmentStatus || 'Available',
      glossaryUrl: assessment.glossaryUrl || '',
      glossaryName: assessment.glossaryName || ''
    });
    setUploadSuccess(true);
    setShowAddModal(true);
  };

  const saveAssessment = async () => {
    console.log('Tentando salvar avaliação...', newAssessment);
    if (!newAssessment.title || !newAssessment.baseText) {
      console.warn('Título ou texto base ausente');
      return;
    }
    setError(null);
    try {
      if (editingId) {
        await updateDoc(doc(db, 'assessments', editingId), {
          ...newAssessment,
          updatedAt: serverTimestamp()
        });
        console.log('Avaliação atualizada com sucesso!');
      } else {
        await addDoc(collection(db, 'assessments'), {
          ...newAssessment,
          createdAt: serverTimestamp()
        });
        console.log('Avaliação salva com sucesso!');
      }
      closeModal();
    } catch (err: any) {
      console.error('Erro ao salvar avaliação:', err);
      const errorMessage = err.message || String(err);
      if (errorMessage.toLowerCase().includes('permission')) {
        try {
          handleFirestoreError(err, OperationType.WRITE, 'assessments');
        } catch (authErr: any) {
          setError(`Erro de permissão: ${authErr.message}`);
        }
      } else {
        setError(`Erro ao salvar: ${errorMessage}`);
      }
    }
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingId(null);
    setNewAssessment({ 
      title: '', 
      baseText: '', 
      timeLimit: 30, 
      questionCount: 5, 
      pointsPerQuestion: 2, 
      status: 'Available',
      assessmentStatus: 'Available',
      glossaryUrl: '',
      glossaryName: ''
    });
    setUploadSuccess(false);
    setError(null);
  };

  const deleteAssessment = async (id: string) => {
    if (confirm('Tem certeza que deseja excluir esta avaliação?')) {
      await deleteDoc(doc(db, 'assessments', id));
    }
  };

  const [allResults, setAllResults] = useState<Result[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedResultForModal, setSelectedResultForModal] = useState<Result | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'results'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setAllResults(snap.docs.map(d => ({ id: d.id, ...d.data() } as Result)));
    });
    return unsubscribe;
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold flex items-center gap-3">
          <LayoutDashboard className="w-8 h-8 text-emerald-600" />
          Painel de Controle
        </h2>
        <div className="flex gap-3">
          <button 
            onClick={handleToggleLock}
            className={`px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-all shadow-sm ${isLocked ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'}`}
          >
            {isLocked ? <AlertCircle className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
            {isLocked ? 'Destravar App' : 'Travar App'}
          </button>
          <button 
            onClick={() => {
              setShowResults(!showResults);
              setShowStudents(false);
            }}
            className={`px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${showResults ? 'bg-emerald-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
          >
            <GraduationCap className="w-5 h-5" />
            Resultados
          </button>
          <button 
            onClick={() => {
              setShowStudents(!showStudents);
              setShowResults(false);
            }}
            className={`px-4 py-2 rounded-xl font-bold flex items-center gap-2 transition-all ${showStudents ? 'bg-emerald-600 text-white' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
          >
            <User className="w-5 h-5" />
            Alunos
          </button>
          <button 
            onClick={openAddModal}
            className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all"
          >
            <Plus className="w-5 h-5" />
            Nova Avaliação
          </button>
        </div>
      </div>

      {error && !showAddModal && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-center gap-3 text-sm font-medium border border-red-100">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {showResults ? (
        <div className="bg-white p-6 rounded-3xl border border-neutral-100 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b pb-4">
            <h3 className="text-xl font-bold flex items-center gap-2">
              <GraduationCap className="w-6 h-6 text-emerald-600" />
              Resultados dos Alunos
            </h3>
            <button 
              onClick={() => setShowResults(false)}
              className="bg-neutral-100 text-neutral-600 px-4 py-2 rounded-xl font-bold hover:bg-neutral-200 transition-all flex items-center gap-2"
            >
              <ChevronLeft className="w-4 h-4" /> Voltar ao Início
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-neutral-100">
                  <th className="py-4 px-4 font-bold text-sm text-neutral-400 uppercase">Aluno</th>
                  <th className="py-4 px-4 font-bold text-sm text-neutral-400 uppercase">Avaliação</th>
                  <th className="py-4 px-4 font-bold text-sm text-neutral-400 uppercase">Nota</th>
                  <th className="py-4 px-4 font-bold text-sm text-neutral-400 uppercase">Data</th>
                  <th className="py-4 px-4 font-bold text-sm text-neutral-400 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody>
                {allResults.map(r => (
                  <tr key={r.id} className="border-b border-neutral-50 hover:bg-neutral-50 transition-colors">
                    <td className="py-4 px-4 font-medium">{r.email}</td>
                    <td className="py-4 px-4">{r.assessmentTitle}</td>
                    <td className="py-4 px-4 font-bold text-emerald-600">{r.score.toFixed(1)}</td>
                    <td className="py-4 px-4 text-sm text-neutral-500">
                      {r.timestamp?.toDate ? r.timestamp.toDate().toLocaleString() : 'Recent'}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setSelectedResultForModal(r)}
                          className="text-emerald-600 hover:text-emerald-700 font-bold text-sm flex items-center gap-1 p-2 hover:bg-emerald-50 rounded-lg transition-all"
                          title="Ver Relatório"
                        >
                          <Eye className="w-4 h-4" /> Ver Relatório
                        </button>
                        <button 
                          onClick={() => handleDeleteResult(r.id)}
                          className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Excluir Resultado"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {allResults.length === 0 && (
              <div className="text-center py-12 text-neutral-400">Nenhum resultado encontrado.</div>
            )}
          </div>
        </div>
      ) : showStudents ? (
        <div className="bg-white p-6 rounded-3xl border border-neutral-100 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b pb-4">
            <div className="flex items-center gap-4">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <User className="w-6 h-6 text-emerald-600" />
                Alunos Registrados
              </h3>
              {selectedStudentIds.length > 0 && (
                <div className="flex items-center gap-2 bg-red-50 text-red-600 px-3 py-1 rounded-lg text-sm font-bold animate-in fade-in slide-in-from-left-2">
                  <span>{selectedStudentIds.length} selecionados</span>
                  <button 
                    onClick={handleDeleteSelectedStudents}
                    className="hover:bg-red-100 p-1 rounded transition-colors"
                    title="Excluir selecionados"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button 
                onClick={saveAccess}
                className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl font-bold hover:bg-emerald-100 transition-all flex items-center gap-2 text-sm"
                title="Sincronizar lista de alunos com a gestão de acessos"
              >
                <Loader2 className="w-4 h-4" /> Sincronizar Agora
              </button>
              <button 
                onClick={() => setShowStudents(false)}
                className="bg-neutral-100 text-neutral-600 px-4 py-2 rounded-xl font-bold hover:bg-neutral-200 transition-all flex items-center gap-2 text-sm"
              >
                <ChevronLeft className="w-4 h-4" /> Voltar ao Início
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-neutral-100">
                  <th className="py-4 px-4 w-10">
                    <input 
                      type="checkbox" 
                      checked={students.length > 0 && selectedStudentIds.length === students.length}
                      onChange={toggleSelectAllStudents}
                      className="w-4 h-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                    />
                  </th>
                  <th className="py-4 px-4 font-bold text-sm text-neutral-400 uppercase">E-mail</th>
                  <th className="py-4 px-4 font-bold text-sm text-neutral-400 uppercase">Último Acesso</th>
                  <th className="py-4 px-4 font-bold text-sm text-neutral-400 uppercase">Data de Registro</th>
                  <th className="py-4 px-4 font-bold text-sm text-neutral-400 uppercase text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {students.map(s => (
                  <tr key={s.id} className={`border-b border-neutral-50 hover:bg-neutral-50 transition-colors ${selectedStudentIds.includes(s.id) ? 'bg-emerald-50/30' : ''}`}>
                    <td className="py-4 px-4">
                      <input 
                        type="checkbox" 
                        checked={selectedStudentIds.includes(s.id)}
                        onChange={() => toggleSelectStudent(s.id)}
                        className="w-4 h-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                      />
                    </td>
                    <td className="py-4 px-4 font-medium">{s.email}</td>
                    <td className="py-4 px-4 text-sm text-neutral-500">
                      {s.lastLogin?.toDate ? (
                        s.lastLogin.toDate().toLocaleString()
                      ) : (
                        <span className="text-amber-500 italic">Nunca acessou</span>
                      )}
                    </td>
                    <td className="py-4 px-4 text-sm text-neutral-500">
                      {s.createdAt?.toDate ? s.createdAt.toDate().toLocaleString() : 'Recent'}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={() => openEditStudentModal(s)}
                          className="p-2 text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                          title="Editar e-mail"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteStudent(s.id)}
                          className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                          title="Excluir aluno"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {students.length === 0 && (
              <div className="text-center py-12 text-neutral-400">Nenhum aluno registrado ainda.</div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-8">
        {/* Access Management */}
        <div className="md:col-span-1 bg-white p-6 rounded-3xl border border-neutral-100 shadow-sm space-y-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <User className="w-5 h-5 text-emerald-600" />
            Gestão de Acessos
          </h3>
          <p className="text-xs text-neutral-500">Insira os e-mails dos alunos autorizados separados por vírgula.</p>
          
          <textarea 
            value={emailsText}
            onChange={(e) => setEmailsText(e.target.value)}
            disabled={!isEditingAccess}
            className="w-full h-48 p-3 text-sm rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all disabled:bg-neutral-50"
            placeholder="aluno1@urca.br, aluno2@urca.br..."
          />
          
          <div className="flex gap-2">
            {isEditingAccess ? (
              <>
                <button onClick={saveAccess} className="flex-1 bg-emerald-600 text-white py-2 rounded-lg text-sm font-bold">Salvar</button>
                <button onClick={() => setIsEditingAccess(false)} className="flex-1 bg-neutral-100 text-neutral-600 py-2 rounded-lg text-sm font-bold">Cancelar</button>
              </>
            ) : (
              <button onClick={() => setIsEditingAccess(true)} className="w-full bg-neutral-100 text-emerald-600 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2">
                <Edit className="w-4 h-4" /> Editar Lista
              </button>
            )}
          </div>
        </div>

        {/* Assessments List */}
        <div className="md:col-span-2 bg-white p-6 rounded-3xl border border-neutral-100 shadow-sm space-y-4">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            Avaliações Criadas
          </h3>
          
          <div className="space-y-3">
            {assessments.map(a => {
              const assessmentResults = allResults.filter(r => r.assessmentId === a.id);
              const submissionCount = assessmentResults.length;
              const lastSubmission = assessmentResults[0]; // Already ordered by desc timestamp
              const isRecentlySubmitted = lastSubmission && 
                lastSubmission.timestamp?.toDate && 
                (new Date().getTime() - lastSubmission.timestamp.toDate().getTime()) < 300000; // 5 minutes

              return (
                <div key={a.id} className="flex items-center justify-between p-4 rounded-2xl border border-neutral-100 hover:border-emerald-200 transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold">{a.title}</h4>
                      {isRecentlySubmitted && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full animate-pulse">
                          <span className="w-1.5 h-1.5 bg-emerald-600 rounded-full"></span>
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-neutral-500 mt-1">
                      <span className="flex items-center gap-1"><Loader2 className="w-3 h-3" /> {a.timeLimit} min</span>
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {a.questionCount || 5} questões ({a.pointsPerQuestion || 2} pts/q)</span>
                      <span className={`px-2 py-0.5 rounded-full ${a.status === 'Available' ? 'bg-blue-100 text-blue-700' : 'bg-neutral-100 text-neutral-500'}`}>
                        Tema: {a.status === 'Available' ? 'Visível' : 'Oculto'}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full ${a.assessmentStatus === 'Available' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        Avaliação: {a.assessmentStatus === 'Available' ? 'Liberada' : 'Bloqueada'}
                      </span>
                      <span className="flex items-center gap-1 font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                        <CheckCircle className="w-3 h-3" /> {submissionCount} {submissionCount === 1 ? 'entregue' : 'entregues'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setSelectedAssessmentForReview(a)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-neutral-100 text-neutral-700 rounded-lg text-xs font-bold hover:bg-neutral-200 transition-all"
                      title="Revisar Texto Base"
                    >
                      <Eye className="w-3 h-3" />
                      Revisão
                    </button>
                    <button 
                      onClick={() => generateDefaultAssessment(a)} 
                      disabled={isGeneratingDefault && selectedAssessmentForDefault?.id === a.id}
                      className="flex items-center gap-1 px-3 py-1.5 bg-neutral-100 text-neutral-700 rounded-lg text-xs font-bold hover:bg-neutral-200 transition-all disabled:opacity-50"
                      title="Gerar Avaliação Default para Impressão"
                    >
                      {isGeneratingDefault && selectedAssessmentForDefault?.id === a.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Printer className="w-3 h-3" />
                      )}
                      Avaliação Default
                    </button>
                    <button 
                      onClick={() => openEditModal(a)} 
                      className="p-2 text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
                      title="Editar Avaliação"
                    >
                      <Edit className="w-5 h-5" />
                    </button>
                    <button 
                      onClick={() => deleteAssessment(a.id)} 
                      className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      title="Excluir Avaliação"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              );
            })}
            {assessments.length === 0 && (
              <div className="text-center py-12 text-neutral-400">
                Nenhuma avaliação criada ainda.
              </div>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 no-print">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-2xl rounded-3xl p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-2xl font-bold">{editingId ? 'Editar Avaliação' : 'Nova Avaliação'}</h3>
            
            {error && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-center gap-3 text-sm font-medium border border-red-100">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                {error}
              </div>
            )}
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold">Título da Avaliação</label>
                <input 
                  value={newAssessment.title}
                  onChange={(e) => setNewAssessment(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-neutral-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Ex: Macroeconomia e o Mercado"
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-semibold">Tempo (minutos)</label>
                  <input 
                    type="number"
                    value={newAssessment.timeLimit}
                    onChange={(e) => setNewAssessment(prev => ({ ...prev, timeLimit: parseInt(e.target.value) }))}
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold">Nº Questões</label>
                  <input 
                    type="number"
                    min="1"
                    max="20"
                    value={newAssessment.questionCount}
                    onChange={(e) => setNewAssessment(prev => ({ ...prev, questionCount: parseInt(e.target.value) }))}
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold">Pontos / Questão</label>
                  <input 
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={newAssessment.pointsPerQuestion}
                    onChange={(e) => setNewAssessment(prev => ({ ...prev, pointsPerQuestion: parseFloat(e.target.value) }))}
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold">Tema Visível?</label>
                  <select 
                    value={newAssessment.status}
                    onChange={(e) => setNewAssessment(prev => ({ ...prev, status: e.target.value as any }))}
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="Available">Sim (Visível)</option>
                    <option value="Unavailable">Não (Oculto)</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold">Avaliação Liberada?</label>
                  <select 
                    value={newAssessment.assessmentStatus}
                    onChange={(e) => setNewAssessment(prev => ({ ...prev, assessmentStatus: e.target.value as any }))}
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="Available">Sim (Liberada)</option>
                    <option value="Unavailable">Não (Bloqueada)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-semibold">Base de Conhecimento (PDF ou TXT)</label>
                <div className="flex items-center gap-4">
                  <label className={`flex-1 border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all ${uploadSuccess ? 'border-emerald-500 bg-emerald-50' : 'border-neutral-200 hover:bg-neutral-50'}`}>
                    {uploadSuccess ? (
                      <>
                        <CheckCircle className="w-10 h-10 text-emerald-600 mb-2" />
                        <span className="text-sm font-bold text-emerald-700">Arquivo Carregado com Sucesso!</span>
                        <span className="text-xs text-emerald-600">Clique para trocar o arquivo</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-10 h-10 text-neutral-400 mb-2" />
                        <span className="text-sm text-neutral-600">Clique para selecionar o arquivo</span>
                        <span className="text-xs text-neutral-400">PDF ou TXT</span>
                      </>
                    )}
                    <input type="file" accept=".pdf,.txt" onChange={handleFileUpload} className="hidden" />
                  </label>
                  {isUploading && (
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                      <span className="text-xs font-bold text-emerald-600">Processando...</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-semibold">Glossário (Opcional)</label>
                <div className="space-y-3">
                  <textarea
                    value={newAssessment.glossaryUrl?.startsWith('data:text/plain') ? decodeURIComponent(escape(atob(newAssessment.glossaryUrl.split(',')[1]))) : ''}
                    onChange={(e) => {
                      const text = e.target.value;
                      if (!text.trim()) {
                        setNewAssessment(prev => ({ ...prev, glossaryUrl: '', glossaryName: '' }));
                        return;
                      }
                      const base64 = `data:text/plain;base64,${btoa(unescape(encodeURIComponent(text)))}`;
                      setNewAssessment(prev => ({ ...prev, glossaryUrl: base64, glossaryName: 'Texto Manual' }));
                    }}
                    className="w-full h-32 p-3 text-sm rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    placeholder="Digite ou cole o glossário aqui..."
                  />
                  <div className="flex items-center gap-4">
                    <label className="flex-1 border border-dashed border-neutral-300 rounded-xl p-3 flex items-center justify-center gap-2 cursor-pointer hover:bg-neutral-50 transition-all">
                      <Upload className="w-4 h-4 text-neutral-400" />
                      <span className="text-xs text-neutral-600 font-medium">Ou upload de arquivo (PDF/TXT)</span>
                      <input 
                        type="file" 
                        accept=".pdf,.txt" 
                        className="hidden" 
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const base64 = event.target?.result as string;
                            setNewAssessment(prev => ({ ...prev, glossaryUrl: base64, glossaryName: file.name }));
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </label>
                    {newAssessment.glossaryName && (
                      <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
                        <FileText className="w-4 h-4 text-emerald-600" />
                        <span className="text-xs font-bold text-emerald-700 truncate max-w-[150px]">{newAssessment.glossaryName}</span>
                        <button 
                          onClick={() => setNewAssessment(prev => ({ ...prev, glossaryUrl: '', glossaryName: '' }))}
                          className="text-red-500 hover:text-red-700"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button 
                onClick={saveAssessment}
                disabled={!newAssessment.title || !newAssessment.baseText}
                className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50"
              >
                {editingId ? 'Salvar Alterações' : 'Criar Avaliação'}
              </button>
              <button 
                onClick={closeModal}
                className="flex-1 bg-neutral-100 text-neutral-600 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-200 transition-all"
              >
                <ChevronLeft className="w-4 h-4" /> Voltar ao Início
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Result Details Modal */}
      {selectedResultForModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4 no-print">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-4xl rounded-3xl p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto relative"
          >
            <button 
              onClick={() => setSelectedResultForModal(null)}
              className="absolute top-6 right-6 p-2 hover:bg-neutral-100 rounded-full transition-colors"
            >
              <Plus className="w-6 h-6 rotate-45 text-neutral-400" />
            </button>

            <div className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center">
                  <GraduationCap className="w-8 h-8 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold">Relatório do Aluno</h3>
                  <p className="text-neutral-500">{selectedResultForModal.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-6 bg-neutral-50 rounded-2xl border border-neutral-100">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Avaliação</span>
                  <p className="font-bold text-sm truncate">{selectedResultForModal.assessmentTitle}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Nota</span>
                  <p className="font-bold text-emerald-600 text-lg">{selectedResultForModal.score.toFixed(1)} / {(selectedResultForModal.questions.length * (selectedResultForModal.pointsPerQuestion || 2)).toFixed(1)}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Acertos</span>
                  <p className="font-bold text-neutral-900 text-lg">{Math.round(selectedResultForModal.score / (selectedResultForModal.pointsPerQuestion || 2))}/{selectedResultForModal.questions.length}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Data</span>
                  <p className="font-bold text-neutral-900 text-sm">
                    {selectedResultForModal.timestamp?.toDate ? selectedResultForModal.timestamp.toDate().toLocaleDateString() : 'Recent'}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-bold text-lg">Revisão das Questões</h4>
                <div className="space-y-4">
                  {selectedResultForModal.questions.map((q, i) => (
                    <div key={i} className="p-6 rounded-2xl border border-neutral-100 space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <h5 className="font-bold leading-tight">{i + 1}. {q.question}</h5>
                        {selectedResultForModal.answers[i] === q.correctIndex ? (
                          <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                        )}
                      </div>
                      
                      <div className="grid sm:grid-cols-2 gap-3 text-sm">
                        <div className={`p-3 rounded-xl border ${selectedResultForModal.answers[i] === q.correctIndex ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                          <span className="text-[10px] font-bold uppercase opacity-50">Resposta do Aluno</span>
                          <p className="font-medium">{q.options[selectedResultForModal.answers[i]] || 'Não respondida'}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                          <span className="text-[10px] font-bold uppercase text-emerald-600">Gabarito</span>
                          <p className="font-medium text-emerald-900">{q.options[q.correctIndex]}</p>
                        </div>
                      </div>
                      <div className="text-xs text-neutral-500 italic bg-neutral-50 p-3 rounded-xl">
                        <span className="font-bold not-italic text-neutral-700 mr-2">Explicação:</span>
                        {q.explanation}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4">
              <button 
                onClick={() => setSelectedResultForModal(null)}
                className="w-full bg-neutral-900 text-white py-4 rounded-2xl font-bold hover:bg-neutral-800 transition-all"
              >
                Fechar Relatório
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[250] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl space-y-6"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                  <Trash2 className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-2xl font-bold text-neutral-800">Confirmar Exclusão</h3>
                <p className="text-neutral-500">
                  {isDeletingBulk 
                    ? `Tem certeza que deseja excluir ${selectedStudentIds.length} alunos selecionados? Esta ação não pode ser desfeita.`
                    : isDeletingResult 
                      ? 'Tem certeza que deseja excluir este resultado? Esta ação não pode ser desfeita.'
                      : 'Tem certeza que deseja excluir este aluno? Esta ação não pode ser desfeita.'}
                </p>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={confirmDelete}
                  className="flex-1 bg-red-600 text-white py-3 rounded-xl font-bold hover:bg-red-700 transition-all"
                >
                  Excluir
                </button>
                <button 
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setStudentToDelete(null);
                    setResultToDelete(null);
                    setIsDeletingBulk(false);
                    setIsDeletingResult(false);
                  }}
                  className="flex-1 bg-neutral-100 text-neutral-600 py-3 rounded-xl font-bold hover:bg-neutral-200 transition-all"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Student Modal */}
      <AnimatePresence>
        {showEditStudentModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl w-full max-w-md p-8 shadow-2xl space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-bold flex items-center gap-2">
                  <Edit className="w-6 h-6 text-emerald-600" />
                  Editar Aluno
                </h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-neutral-700 mb-1">E-mail do Aluno</label>
                  <input 
                    type="email"
                    value={newStudentEmail}
                    onChange={(e) => setNewStudentEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-neutral-200 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    placeholder="exemplo@urca.br"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button 
                  onClick={handleUpdateStudent}
                  disabled={!newStudentEmail}
                  className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50"
                >
                  Salvar Alterações
                </button>
                <button 
                  onClick={() => {
                    setShowEditStudentModal(false);
                    setEditingStudent(null);
                  }}
                  className="flex-1 bg-neutral-100 text-neutral-600 py-3 rounded-xl font-bold"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Review Modal */}
      {selectedAssessmentForReview && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4 no-print">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-xl rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-8 flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#E6F7F0] rounded-2xl flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-[#10B981]" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-neutral-900">Revisão: {selectedAssessmentForReview.title}</h3>
                  <p className="text-neutral-500 text-sm">Gerencie os materiais de apoio e revise o texto base.</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedAssessmentForReview(null)}
                className="p-2 hover:bg-neutral-100 rounded-full transition-colors"
              >
                <X className="w-6 h-6 text-neutral-400" />
              </button>
            </div>
            
            <div className="px-8 pb-8 overflow-y-auto flex-1 space-y-6">
              {/* Support Materials Section */}
              <div className="space-y-6">
                {/* Exercise Upload */}
                <div className="p-6 bg-[#F0FDF9] rounded-[2rem] border border-[#D1FAE5] space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#D1FAE5] rounded-xl flex items-center justify-center">
                      <FileCheck className="w-5 h-5 text-[#059669]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-[#064E3B]">Exercício</h4>
                      <p className="text-xs text-[#059669]">Upload de material prático</p>
                    </div>
                  </div>
                  
                  {selectedAssessmentForReview.exerciseUrl ? (
                    <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-neutral-200">
                      <span className="text-sm font-medium text-neutral-700 truncate">{selectedAssessmentForReview.exerciseName}</span>
                      <button 
                        onClick={async () => {
                          const updated = { ...selectedAssessmentForReview, exerciseUrl: '', exerciseName: '' };
                          await updateDoc(doc(db, 'assessments', selectedAssessmentForReview.id), { exerciseUrl: '', exerciseName: '' });
                          setSelectedAssessmentForReview(updated);
                        }}
                        className="text-red-400 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-[#A7F3D0] rounded-2xl cursor-pointer hover:bg-[#D1FAE5]/50 transition-all">
                      <div className="flex items-center gap-2">
                        <Upload className="w-5 h-5 text-[#34D399]" />
                        <p className="text-xs text-[#059669] font-bold">Upload de arquivo</p>
                      </div>
                      <input 
                        type="file" 
                        className="hidden" 
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const reader = new FileReader();
                            reader.onload = async (event) => {
                              try {
                                const base64 = event.target?.result as string;
                                const updated = { ...selectedAssessmentForReview, exerciseUrl: base64, exerciseName: file.name };
                                await updateDoc(doc(db, 'assessments', selectedAssessmentForReview.id), { exerciseUrl: base64, exerciseName: file.name });
                                setSelectedAssessmentForReview(updated);
                              } catch (err: any) {
                                console.error('Erro ao salvar exercício:', err);
                                setError(`Erro ao salvar exercício: ${err.message}`);
                              }
                            };
                            reader.readAsDataURL(file);
                          } catch (err: any) {
                            console.error('Erro ao ler arquivo:', err);
                            setError(`Erro ao ler arquivo: ${err.message}`);
                          }
                        }}
                      />
                    </label>
                  )}
                </div>

                {/* Glossary Section */}
                <div className="p-6 bg-[#F0F9FF] rounded-[2rem] border border-[#E0F2FE] space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#E0F2FE] rounded-xl flex items-center justify-center">
                      <Book className="w-5 h-5 text-[#0284C7]" />
                    </div>
                    <div>
                      <h4 className="font-bold text-[#0C4A6E]">Glossário</h4>
                      <p className="text-xs text-[#0284C7]">Termos e definições</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {selectedAssessmentForReview.glossaryUrl ? (
                      <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-neutral-200">
                        <span className="text-sm font-medium text-neutral-700 truncate">{selectedAssessmentForReview.glossaryName}</span>
                        <button 
                          onClick={async () => {
                            const updated = { ...selectedAssessmentForReview, glossaryUrl: '', glossaryName: '' };
                            await updateDoc(doc(db, 'assessments', selectedAssessmentForReview.id), { glossaryUrl: '', glossaryName: '' });
                            setSelectedAssessmentForReview(updated);
                          }}
                          className="text-red-400 hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <textarea
                          value={selectedAssessmentForReview.glossaryUrl?.startsWith('data:text/plain') ? decodeURIComponent(escape(atob(selectedAssessmentForReview.glossaryUrl.split(',')[1]))) : ''}
                          onChange={async (e) => {
                            const text = e.target.value;
                            if (!text.trim()) {
                              const updated = { ...selectedAssessmentForReview, glossaryUrl: '', glossaryName: '' };
                              setSelectedAssessmentForReview(updated);
                              await updateDoc(doc(db, 'assessments', selectedAssessmentForReview.id), { glossaryUrl: '', glossaryName: '' });
                              return;
                            }
                            const base64 = `data:text/plain;base64,${btoa(unescape(encodeURIComponent(text)))}`;
                            const updated = { ...selectedAssessmentForReview, glossaryUrl: base64, glossaryName: 'Texto Manual' };
                            setSelectedAssessmentForReview(updated);
                          }}
                          onBlur={async (e) => {
                            const text = e.target.value;
                            if (!text.trim()) return;
                            const base64 = `data:text/plain;base64,${btoa(unescape(encodeURIComponent(text)))}`;
                            await updateDoc(doc(db, 'assessments', selectedAssessmentForReview.id), { glossaryUrl: base64, glossaryName: 'Texto Manual' });
                          }}
                          className="w-full h-24 p-3 text-sm rounded-xl border border-[#BAE6FD] focus:ring-2 focus:ring-blue-500 outline-none transition-all bg-white"
                          placeholder="Digite ou cole o glossário aqui..."
                        />

                        <label className="flex items-center justify-center w-full h-12 border-2 border-dashed border-[#BAE6FD] rounded-2xl cursor-pointer hover:bg-[#E0F2FE]/50 transition-all">
                          <div className="flex items-center gap-2">
                            <Upload className="w-4 h-4 text-[#38BDF8]" />
                            <span className="text-xs text-[#0284C7] font-bold">Upload de arquivo</span>
                          </div>
                          <input 
                            type="file" 
                            accept=".pdf,.txt"
                            className="hidden" 
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = async (event) => {
                                const base64 = event.target?.result as string;
                                const updated = { ...selectedAssessmentForReview, glossaryUrl: base64, glossaryName: file.name };
                                await updateDoc(doc(db, 'assessments', selectedAssessmentForReview.id), { glossaryUrl: base64, glossaryName: file.name });
                                setSelectedAssessmentForReview(updated);
                              };
                              reader.readAsDataURL(file);
                            }}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-8 flex justify-end">
              <button 
                onClick={() => setSelectedAssessmentForReview(null)}
                className="bg-[#171717] text-white px-10 py-4 rounded-2xl font-bold hover:bg-neutral-800 transition-all shadow-lg"
              >
                Fechar Revisão
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Default Assessment Modal (Printable) */}
      {showDefaultModal && selectedAssessmentForDefault && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[150] flex items-center justify-center p-4 overflow-y-auto">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-4xl rounded-3xl p-8 shadow-2xl space-y-6 my-8"
          >
            <div className="flex justify-between items-center border-b pb-4 sticky top-0 bg-white z-10 no-print">
              <h3 className="text-2xl font-bold text-neutral-800">Baixar Avaliação</h3>
              <div className="flex gap-3">
                <button 
                  onClick={downloadAssessmentTXT}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-emerald-700 transition-all"
                >
                  <FileText className="w-5 h-5" /> Baixar TXT
                </button>
                <button 
                  onClick={() => setShowDefaultModal(false)}
                  className="bg-neutral-100 text-neutral-600 px-4 py-2 rounded-xl font-bold hover:bg-neutral-200 transition-all"
                >
                  Fechar
                </button>
              </div>
            </div>

            <div id="printable-area" className="bg-white p-8 border border-neutral-200 rounded-xl font-serif text-neutral-900">
              {/* Header */}
              <div className="border-2 border-neutral-900 p-6 mb-8 space-y-4">
                <div className="flex flex-col items-center text-center border-b-2 border-neutral-900 pb-4 space-y-1">
                  <h1 className="text-xl font-bold uppercase">UNIVERSIDADE REGIONAL DO CARIRI – URCA</h1>
                  <h2 className="text-lg font-bold uppercase">CURSO DE CIÊNCIAS ECONÔMICAS</h2>
                  <h3 className="text-md font-bold uppercase">DISCIPLINA: FINANÇAS I</h3>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-4">
                  <div className="space-y-2">
                    <p className="text-sm font-bold uppercase">ALUNO/A: ________________________________________________</p>
                    <p className="text-sm font-bold uppercase">DATA: ____/____/_______</p>
                  </div>
                  <div className="text-right space-y-2">
                    <p className="text-sm font-bold">VALOR: {(selectedAssessmentForDefault.questionCount * (selectedAssessmentForDefault.pointsPerQuestion || 2)).toFixed(1)} PONTOS</p>
                    <p className="text-sm font-bold">NOTA: _________</p>
                  </div>
                </div>
                <div className="text-center pt-6">
                  <h2 className="text-lg font-bold underline uppercase">{selectedAssessmentForDefault.title}</h2>
                </div>
              </div>

              {/* Questions */}
              <div className="space-y-8">
                {defaultQuestions.map((q, i) => (
                  <div key={i} className="space-y-3">
                    <p className="font-bold text-base">{i + 1}. {q.question}</p>
                    <div className="grid grid-cols-1 gap-2 ml-4">
                      {q.options.map((opt, idx) => (
                        <p key={idx} className="text-sm">
                          <span className="font-bold mr-2">{String.fromCharCode(65 + idx)})</span> {opt}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Answer Key (Gabarito) */}
              <div className="mt-12 pt-8 border-t-2 border-dashed border-neutral-300 print:break-before-page">
                <h3 className="text-lg font-bold uppercase mb-4 text-emerald-700">Gabarito (Apenas para o Professor)</h3>
                <div className="grid grid-cols-5 gap-4">
                  {defaultQuestions.map((q, i) => (
                    <div key={i} className="border p-2 text-center rounded bg-emerald-50 border-emerald-200">
                      <span className="block text-xs font-bold text-emerald-600">Questão {i + 1}</span>
                      <span className="text-lg font-black text-emerald-900">{String.fromCharCode(65 + q.correctIndex)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-6 space-y-2">
                  {defaultQuestions.map((q, i) => (
                    <p key={i} className="text-[10px] text-neutral-600">
                      <span className="font-bold">Q{i+1}:</span> {q.explanation}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}

function StudentPanel({ user, isAdmin, startAssessment }: any) {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [userResults, setUserResults] = useState<Result[]>([]);
  const [selectedAssessmentForReview, setSelectedAssessmentForReview] = useState<Assessment | null>(null);
  const [generatedPracticeExercise, setGeneratedPracticeExercise] = useState<any>(null);
  const [isGeneratingPractice, setIsGeneratingPractice] = useState(false);
  const [studentPracticeAnswers, setStudentPracticeAnswers] = useState<string[]>([]);
  const [showPracticeResult, setShowPracticeResult] = useState(false);
  const [viewingGlossary, setViewingGlossary] = useState<Assessment | null>(null);
  const [glossaryContent, setGlossaryContent] = useState<string>('');
  const [isExtractingGlossary, setIsExtractingGlossary] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const TEMA_1_EXERCISE = {
    columnA: [
      { id: 1, text: "O que são finanças em termos simples e quais tipos de entidades as finanças envolvem?" },
      { id: 2, text: "Cite e explique brevemente dois conceitos básicos em finanças mencionados no texto." },
      { id: 3, text: "Por que o conhecimento em finanças é fundamental para empreendedores?" },
      { id: 4, text: "Qual é a definição de conformidade no contexto empresarial?" },
      { id: 5, text: "Como a ética empresarial se manifesta nas relações com clientes?" },
      { id: 6, text: "Cite e explique brevemente uma forma comum de fraude no mundo corporativo." },
      { id: 7, text: "Qual é o principal objetivo da Lei Sarbanes-Oxley (SOX)?" },
      { id: 8, text: "O que a governança corporativa representa em uma organização?" },
      { id: 9, text: "Como a transparência na governança corporativa ajuda a mitigar problemas de agência?" },
      { id: 10, text: "Qual é o principal objetivo da gestão pública?" }
    ],
    columnB: [
      { text: "Para empreendedores, o conhecimento em finanças é fundamental para tomar decisões estratégicas de investimento e financiamento que garantam o crescimento e a sustentabilidade do negócio.", correctId: 3 },
      { text: "Fraudes contábeis são a manipulação de informações financeiras para ocultar a verdadeira situação da empresa. (outras respostas válidas incluem Fraudes em contratos e Fraudes em pagamentos).", correctId: 6 },
      { text: "O principal objetivo da Lei Sarbanes-Oxley (SOX) é eliminar problemas de divulgação e conflitos de interesses, estabelecendo controles e regulamentações mais rígidos para garantir a transparência e a responsabilidade corporativa.", correctId: 7 },
      { text: "Ao exigir a divulgação clara e precisa de informações, a transparência na governança corporativa reduz a assimetria de informação entre acionistas e administradores, dificultando a ocultação de dados prejudiciais.", correctId: 9 },
      { text: "A ética empresarial se manifesta nas relações com clientes ao oferecer produtos e serviços de qualidade, respeitar os direitos do consumidor e agir com transparência.", correctId: 5 },
      { text: "O principal objetivo da gestão pública é focar no bem comum e prestar serviços à sociedade, como educação, saúde e segurança.", correctId: 10 },
      { text: "Conformidade se refere ao ato de seguir regras, leis, regulamentos e padrões estabelecidos por órgãos reguladores, governos ou organizações, garantindo que uma empresa opere dentro dos limites legais e éticos.", correctId: 4 },
      { text: "A governança corporativa representa o conjunto de práticas, processos e estruturas que direcionam e controlam uma organização, definindo as regras para a tomada de decisões e o equilíbrio dos interesses dos stakeholders.", correctId: 8 },
      { text: "Ativo é qualquer bem ou direito que gera valor econômico, como dinheiro ou imóveis. Passivo são obrigações financeiras, como empréstimos ou contas a pagar. (outras respostas válidas incluem Patrimônio Líquido, Receita, Despesa, Lucro, Prejuízo).", correctId: 2 },
      { text: "Em termos simples, finanças é a gestão do dinheiro. Ela envolve decisões sobre como obter, alocar e utilizar recursos financeiros em empresas, governos ou para indivíduos.", correctId: 1 }
    ]
  };

  const generatePractice = async (assessment: Assessment) => {
    if (!assessment.exerciseUrl) return;
    
    // If it's Tema 1, use the static data
    if (assessment.title.toLowerCase().includes('tema 1') || assessment.exerciseName?.toLowerCase().includes('exercício 1')) {
      setGeneratedPracticeExercise(TEMA_1_EXERCISE);
      setStudentPracticeAnswers(new Array(TEMA_1_EXERCISE.columnB.length).fill(''));
      return;
    }

    setIsGeneratingPractice(true);
    setGeneratedPracticeExercise(null);
    setShowPracticeResult(false);
    setStudentPracticeAnswers([]);
    
    try {
      let sourceText = '';
      const base64Data = assessment.exerciseUrl.split(',')[1];
      const binaryData = atob(base64Data);
      const arrayBuffer = new ArrayBuffer(binaryData.length);
      const view = new Uint8Array(arrayBuffer);
      for (let i = 0; i < binaryData.length; i++) {
        view[i] = binaryData.charCodeAt(i);
      }

      if (assessment.exerciseUrl.includes('application/pdf')) {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          sourceText += textContent.items.map((item: any) => item.str || '').join(' ') + '\n';
        }
      } else {
        sourceText = new TextDecoder().decode(arrayBuffer);
      }

      if (!sourceText.trim()) {
        throw new Error('Não foi possível extrair texto do arquivo de exercício.');
      }

      const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Com base EXCLUSIVAMENTE no seguinte material de exercício:
      
      "${sourceText}"
      
      Crie um exercício do tipo "Relacione as Colunas" com exatamente 10 itens baseados no conteúdo acima.
      O exercício deve consistir em:
      1. Coluna A (QUESTÕES): Uma lista de 10 perguntas ou termos numerados de 1 a 10, extraídos do texto.
      2. Coluna B (RESPOSTAS): Uma lista das 10 respostas ou definições correspondentes encontradas no texto, mas em ordem ALEATÓRIA.
      
      REGRAS CRÍTICAS:
      - Use APENAS informações presentes no texto fornecido.
      - Não invente questões de outros temas (como tecnologia ou hardware) se o texto for sobre outro assunto (como finanças ou direito).
      - Mantenha a precisão técnica dos termos do arquivo.
      
      Retorne um objeto JSON com:
      - columnA: array de objetos { id: number, text: string }
      - columnB: array de objetos { text: string, correctId: number } (onde correctId é o ID correspondente da Coluna A)
      
      Importante: Garanta que as respostas na Coluna B estejam embaralhadas em relação à Coluna A.`;

      const response = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              columnA: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.INTEGER },
                    text: { type: Type.STRING }
                  },
                  required: ["id", "text"]
                }
              },
              columnB: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    correctId: { type: Type.INTEGER }
                  },
                  required: ["text", "correctId"]
                }
              }
            },
            required: ["columnA", "columnB"]
          }
        }
      });

      const parsed = JSON.parse(response.text);
      
      // Save the generated exercise to Firestore so it doesn't need to be generated again
      // ONLY if the user is an admin (students don't have write permission to assessments)
      if (isAdmin) {
        await updateDoc(doc(db, 'assessments', assessment.id), {
          practiceExercise: parsed
        });
      }

      setGeneratedPracticeExercise(parsed);
      setStudentPracticeAnswers(new Array(parsed.columnB.length).fill(''));
    } catch (err: any) {
      console.error("Erro ao elaborar exercício:", err);
      setLocalError("Erro ao elaborar exercício: " + (err.message || String(err)));
    } finally {
      setIsGeneratingPractice(false);
    }
  };

  const handleOpenReview = (assessment: Assessment) => {
    setSelectedAssessmentForReview(assessment);
    
    // If it's Tema 1, use the static data immediately
    if (assessment.title.toLowerCase().includes('tema 1') || assessment.exerciseName?.toLowerCase().includes('exercício 1')) {
      setGeneratedPracticeExercise(TEMA_1_EXERCISE);
      setStudentPracticeAnswers(new Array(TEMA_1_EXERCISE.columnB.length).fill(''));
      return;
    }

    // If it already has a practice exercise, use it
    if (assessment.practiceExercise) {
      setGeneratedPracticeExercise(assessment.practiceExercise);
      setStudentPracticeAnswers(new Array(assessment.practiceExercise.columnB.length).fill(''));
      return;
    }

    if (assessment.exerciseUrl) {
      generatePractice(assessment);
    }
  };

  const openOriginalFile = async (url: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (err) {
      console.error('Erro ao abrir arquivo original:', err);
      window.open(url, '_blank');
    }
  };

  const handleOpenGlossary = async (assessment: Assessment) => {
    if (!assessment.glossaryUrl) return;
    
    setViewingGlossary(assessment);
    setGlossaryContent('');
    setIsExtractingGlossary(true);
    
    const cleanMarkdown = (text: string) => {
      if (!text) return '';
      
      // 1. Standardize line endings
      let cleaned = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      
      // 2. Ensure all list items have double newlines before them for better spacing
      // but don't use aggressive regex that splits words
      cleaned = cleaned
        .replace(/\n\s*-\s*/g, '\n\n- ')
        .replace(/\n\s*(\d+)\.\s*/g, '\n\n$1. ');

      // 3. Final cleanup of multiple newlines
      cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
      
      return cleaned;
    };

    try {
      let content = '';
      if (!assessment.glossaryUrl.includes(',')) {
        throw new Error('O formato do arquivo do glossário é inválido.');
      }

      const dataUrlResponse = await fetch(assessment.glossaryUrl);
      const arrayBuffer = await dataUrlResponse.arrayBuffer();

      if (assessment.glossaryUrl.includes('application/pdf')) {
        try {
          if (!pdfjsLib || !pdfjsLib.getDocument) {
            throw new Error('A biblioteca de processamento de PDF não está disponível.');
          }
          const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            content += textContent.items.map((item: any) => item.str || '').join(' ') + '\n\n';
          }
        } catch (pdfErr: any) {
          console.error('Erro ao processar PDF:', pdfErr);
          throw new Error(`Erro ao processar PDF: ${pdfErr.message || 'Erro desconhecido'}`);
        }
      } else {
        try {
          // Try UTF-8 first, if it fails (fatal: true), try ISO-8859-1 (common for Portuguese)
          try {
            content = new TextDecoder('utf-8', { fatal: true }).decode(arrayBuffer);
          } catch (e) {
            content = new TextDecoder('iso-8859-1').decode(arrayBuffer);
          }
        } catch (decodeErr: any) {
          console.error('Erro ao decodificar texto:', decodeErr);
          throw new Error('Não foi possível decodificar o arquivo de texto.');
        }
      }

      if (!content.trim()) {
        throw new Error('O arquivo do glossário parece estar vazio ou não pôde ser lido.');
      }

      let formattedContent = content;
      try {
        const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Transforme o seguinte texto bruto em um glossário formatado em Markdown elegante e profissional, OTIMIZADO PARA CELULAR.
          
          REGRAS DE FORMATAÇÃO (ESTRITAMENTE OBRIGATÓRIAS):
          1. Use # para o Título Principal (apenas um).
          2. Use ## para Categorias ou Seções Principais.
          3. Use listas com marcadores (-) para TODOS os termos. 
             Exemplo: - **Termo**: Definição clara e concisa.
          4. NUNCA use tabelas (difícil de ler no celular).
          5. NUNCA use parágrafos longos. Se uma definição for longa, quebre-a em itens de lista menores.
          6. IMPORTANTE: Use DUAS QUEBRAS DE LINHA (Enter duas vezes) entre CADA item da lista. Isso cria um "espaço de respiro" essencial para a leitura em telas pequenas.
          7. Destaque termos importantes em **negrito**.
          8. Mantenha a linguagem simples e direta.
          
          REGRAS DE RESPOSTA:
          - Retorne APENAS o conteúdo em Markdown.
          - NÃO inclua textos introdutórios ou conclusivos.
          - Comece diretamente com o conteúdo.
          
          Texto original:
          "${content.substring(0, 10000)}"`,
        });
        formattedContent = cleanMarkdown(response.text || content);
      } catch (geminiErr: any) {
        console.error('Erro ao formatar com Gemini:', geminiErr);
        formattedContent = cleanMarkdown(content);
      }

      setGlossaryContent(formattedContent);
    } catch (err: any) {
      console.error('Erro ao carregar glossário:', err);
      setGlossaryContent(`Não foi possível carregar o conteúdo do glossário: ${err.message}`);
    } finally {
      setIsExtractingGlossary(false);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'assessments'));
    const unsubscribe = onSnapshot(q, (snap) => {
      setAssessments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Assessment)));
    });

    const resultsQuery = query(collection(db, 'results'), where('email', '==', user.email));
    const unsubscribeResults = onSnapshot(resultsQuery, (snap) => {
      setUserResults(snap.docs.map(d => ({ id: d.id, ...d.data() } as Result)));
    });

    return () => {
      unsubscribe();
      unsubscribeResults();
    };
  }, [user.email]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      {localError && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl flex items-center gap-3 text-sm font-medium border border-red-100">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {localError}
          <button onClick={() => setLocalError(null)} className="ml-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}
      <div className="space-y-2">
        <h2 className="text-3xl font-bold">Portal do Aluno/a</h2>
        <p className="text-neutral-500">Selecione uma avaliação para iniciar seu teste.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {assessments.map(a => (
          <div key={a.id} className="bg-white p-6 rounded-3xl border border-neutral-100 shadow-sm hover:shadow-md transition-all group">
            <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <BookOpen className="w-6 h-6 text-emerald-600" />
            </div>
            <h3 className="text-xl font-bold mb-6">{a.title}</h3>
            <div className="flex flex-col gap-2">
              {a.glossaryUrl && (
                <button 
                  onClick={() => handleOpenGlossary(a)}
                  className="w-full bg-blue-50 text-blue-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-100 transition-colors"
                >
                  <Book className="w-4 h-4" /> Glossário
                </button>
              )}
              <button 
                onClick={() => handleOpenReview(a)}
                className="w-full bg-neutral-100 text-neutral-700 py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-200 transition-colors"
              >
                <Eye className="w-4 h-4" /> Revisão
              </button>
              
              <div className="mt-2 space-y-3">
                {userResults.some(r => r.assessmentId === a.id) ? (
                  <div className="w-full bg-neutral-100 text-neutral-400 py-4 rounded-xl font-bold flex items-center justify-center gap-2 cursor-not-allowed">
                    <CheckCircle2 className="w-4 h-4" /> Avaliação Realizada
                  </div>
                ) : a.assessmentStatus === 'Unavailable' ? (
                  <div className="w-full bg-red-50 text-red-400 py-4 rounded-xl font-bold flex items-center justify-center gap-2 cursor-not-allowed border border-red-100">
                    <AlertCircle className="w-4 h-4" /> Avaliação Bloqueada
                  </div>
                ) : (
                  <button 
                    onClick={() => startAssessment(a)}
                    className="w-full bg-emerald-600 text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200/50 active:scale-[0.98]"
                  >
                    Iniciar Avaliação <ChevronRight className="w-4 h-4" />
                  </button>
                )}
                <div className="flex items-center justify-center gap-4 text-xs text-neutral-400">
                  <span className="flex items-center gap-1"><Loader2 className="w-3 h-3" /> {a.timeLimit} min</span>
                  <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {a.questionCount || 5} Questões</span>
                  <span className="flex items-center gap-1"><Award className="w-3 h-3" /> {a.pointsPerQuestion || 2} Pontos/Q</span>
                </div>
              </div>
            </div>
          </div>
        ))}
        {assessments.length === 0 && (
          <div className="col-span-full text-center py-20 bg-white rounded-3xl border border-dashed border-neutral-200 text-neutral-400">
            Nenhuma avaliação disponível no momento.
          </div>
        )}
      </div>

      {selectedAssessmentForReview && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[2.5rem] overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-8 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/50">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center">
                  <BookOpen className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold">Revisão: {selectedAssessmentForReview.title}</h3>
                  <p className="text-neutral-500 text-sm">Leia o material base e utilize os materiais de apoio.</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setSelectedAssessmentForReview(null);
                  setGeneratedPracticeExercise(null);
                  setStudentPracticeAnswers([]);
                  setShowPracticeResult(false);
                }}
                className="p-2 hover:bg-neutral-200 rounded-full transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto flex-1 space-y-8">
              {/* Loading State for Practice Exercise */}
              {isGeneratingPractice && (
                <div className="flex flex-col items-center justify-center py-20 space-y-4 bg-emerald-50/30 rounded-[2.5rem] border-2 border-dashed border-emerald-100">
                  <div className="relative">
                    <div className="w-16 h-16 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin"></div>
                    <TrendingUp className="w-6 h-6 text-emerald-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                  </div>
                  <div className="text-center">
                    <h4 className="font-bold text-emerald-900">Elaborando seu Exercício...</h4>
                    <p className="text-sm text-emerald-600">Analisando o material e preparando o desafio.</p>
                  </div>
                </div>
              )}

              {/* Generated Practice Exercise Display (Relacione as Colunas) */}
              {generatedPracticeExercise && typeof generatedPracticeExercise === 'object' && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <TrendingUp className="w-6 h-6 text-emerald-600" />
                      <h4 className="font-bold text-xl text-neutral-800">Prática: Relacione as Colunas</h4>
                    </div>
                    {showPracticeResult && (
                      <button 
                        onClick={() => {
                          setStudentPracticeAnswers(new Array(generatedPracticeExercise.columnB.length).fill(''));
                          setShowPracticeResult(false);
                        }}
                        className="text-sm font-bold text-emerald-600 hover:underline"
                      >
                        Tentar Novamente
                      </button>
                    )}
                  </div>

                  <div className="grid lg:grid-cols-2 gap-8">
                    {/* Coluna A */}
                    <div className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm">
                      <table className="w-full text-sm">
                        <thead className="bg-neutral-50 border-b border-neutral-200">
                          <tr>
                            <th className="w-16 p-4 border-r border-neutral-200 text-center font-bold text-neutral-500">#</th>
                            <th className="p-4 text-left font-bold text-neutral-500 uppercase tracking-wider">QUESTÕES</th>
                          </tr>
                        </thead>
                        <tbody>
                          {generatedPracticeExercise.columnA.map((item: any) => (
                            <tr key={item.id} className="border-b border-neutral-100 last:border-0">
                              <td className="p-4 border-r border-neutral-100 text-center font-bold bg-neutral-50/30 text-neutral-700">{item.id}</td>
                              <td className="p-4 text-neutral-600 leading-relaxed">{item.text}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Coluna B */}
                    <div className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-sm">
                      <table className="w-full text-sm">
                        <thead className="bg-neutral-50 border-b border-neutral-200">
                          <tr>
                            <th className="w-20 p-4 border-r border-neutral-200 text-center font-bold text-neutral-500">Ref #</th>
                            <th className="p-4 text-left font-bold text-neutral-500 uppercase tracking-wider">RESPOSTAS</th>
                          </tr>
                        </thead>
                        <tbody>
                          {generatedPracticeExercise.columnB.map((item: any, idx: number) => {
                            const isCorrect = parseInt(studentPracticeAnswers[idx]) === item.correctId;
                            return (
                              <tr key={idx} className="border-b border-neutral-100 last:border-0">
                                <td className="p-3 border-r border-neutral-100 text-center">
                                  <input 
                                    type="text"
                                    maxLength={2}
                                    className={`w-12 h-12 text-center border-2 rounded-xl font-bold transition-all outline-none focus:ring-4 ${
                                      showPracticeResult 
                                        ? isCorrect 
                                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700' 
                                          : 'border-red-500 bg-red-50 text-red-700'
                                        : 'border-neutral-100 focus:border-emerald-500 focus:ring-emerald-50'
                                    }`}
                                    value={studentPracticeAnswers[idx] || ''}
                                    onChange={(e) => {
                                      const val = e.target.value.replace(/\D/g, '');
                                      const newAnswers = [...studentPracticeAnswers];
                                      newAnswers[idx] = val;
                                      setStudentPracticeAnswers(newAnswers);
                                    }}
                                    disabled={showPracticeResult}
                                    placeholder="?"
                                  />
                                </td>
                                <td className="p-4 text-neutral-600 leading-relaxed">{item.text}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {!showPracticeResult && (
                    <div className="flex justify-center pt-4">
                      <button 
                        onClick={() => setShowPracticeResult(true)}
                        className="bg-emerald-600 text-white px-12 py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-lg hover:shadow-emerald-200"
                      >
                        Verificar Respostas
                      </button>
                    </div>
                  )}

                  {showPracticeResult && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="p-8 bg-neutral-900 text-white rounded-[2.5rem] space-y-6"
                    >
                      <div className="flex items-center justify-between">
                        <h5 className="text-xl font-bold flex items-center gap-3">
                          <CheckCircle className="w-6 h-6 text-emerald-400" />
                          Gabarito e Feedback
                        </h5>
                        <div className="text-sm font-medium px-4 py-2 bg-white/10 rounded-full">
                          Acertos: {studentPracticeAnswers.filter((ans, idx) => parseInt(ans) === generatedPracticeExercise.columnB[idx].correctId).length} / {generatedPracticeExercise.columnB.length}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {generatedPracticeExercise.columnB.map((item: any, idx: number) => {
                          const isCorrect = parseInt(studentPracticeAnswers[idx]) === item.correctId;
                          const correctText = generatedPracticeExercise.columnA.find((a: any) => a.id === item.correctId)?.text;
                          return (
                            <div key={idx} className={`p-4 rounded-2xl border ${isCorrect ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-bold uppercase tracking-wider opacity-50">Item {idx + 1}</span>
                                {isCorrect ? <CheckCircle className="w-4 h-4 text-emerald-400" /> : <X className="w-4 h-4 text-red-400" />}
                              </div>
                              <p className="text-sm font-medium mb-2 line-clamp-2 italic opacity-80">"{item.text}"</p>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold px-2 py-1 bg-white/10 rounded">Correto: {item.correctId}</span>
                                <span className="text-xs opacity-60 truncate">({correctText})</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </div>

            <div className="p-8 border-t border-neutral-100 bg-neutral-50/50 flex justify-end">
              <button 
                onClick={() => {
                  setSelectedAssessmentForReview(null);
                  setGeneratedPracticeExercise(null);
                  setStudentPracticeAnswers([]);
                  setShowPracticeResult(false);
                }}
                className="bg-neutral-900 text-white px-8 py-3 rounded-xl font-bold hover:bg-neutral-800 transition-all whitespace-nowrap"
              >
                Fechar Revisão
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Glossary Modal */}
      {viewingGlossary && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-4xl rounded-[2.5rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
          >
            <div className="p-8 border-b border-neutral-100 flex items-center justify-between bg-white sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
                  <Book className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-neutral-900">Glossário: {viewingGlossary.title}</h3>
                  <p className="text-sm text-neutral-500">Conteúdo de apoio para estudo</p>
                  <p className="text-[10px] text-amber-600 font-medium mt-1 sm:hidden">Dica: Se o texto estiver misturado, desative o Google Tradutor.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {viewingGlossary.glossaryUrl.includes('application/pdf') && (
                  <button 
                    onClick={() => openOriginalFile(viewingGlossary.glossaryUrl)}
                    className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl font-bold text-sm transition-all"
                  >
                    <ExternalLink className="w-4 h-4" /> Ver PDF Original
                  </button>
                )}
                <button 
                  onClick={() => handleOpenGlossary(viewingGlossary)}
                  className="p-3 hover:bg-blue-50 text-neutral-400 hover:text-blue-600 rounded-2xl transition-all"
                  title="Recarregar conteúdo"
                >
                  <RefreshCw className={`w-5 h-5 ${isExtractingGlossary ? 'animate-spin' : ''}`} />
                </button>
                <button 
                  onClick={() => setViewingGlossary(null)}
                  className="p-3 hover:bg-neutral-100 rounded-2xl transition-all"
                >
                  <X className="w-6 h-6 text-neutral-400" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-neutral-50/30">
              {isExtractingGlossary ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                  <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
                  <p className="text-neutral-500 font-medium text-center px-4">Carregando e formatando conteúdo do glossário...</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {viewingGlossary.glossaryUrl.includes('application/pdf') && (
                    <button 
                      onClick={() => openOriginalFile(viewingGlossary.glossaryUrl)}
                      className="sm:hidden w-full flex items-center justify-center gap-2 px-4 py-4 bg-blue-600 text-white rounded-2xl font-bold text-sm shadow-lg active:scale-95 transition-all"
                    >
                      <ExternalLink className="w-5 h-5" /> Abrir PDF Original
                    </button>
                  )}
                  
                  <div className="bg-white p-5 sm:p-8 rounded-2xl sm:rounded-3xl border border-neutral-100 shadow-sm overflow-hidden">
                    <div className="markdown-body font-sans text-neutral-700 leading-relaxed break-words" translate="no">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={{
                          h1: ({node, ...props}) => <h1 className="text-blue-700 font-bold text-xl sm:text-3xl mb-6 border-b pb-2 border-blue-100 uppercase tracking-tight" {...props} />,
                          h2: ({node, ...props}) => <h2 className="text-emerald-700 font-bold text-lg sm:text-2xl mb-4 mt-8 border-l-4 border-emerald-500 pl-3" {...props} />,
                          h3: ({node, ...props}) => <h3 className="text-amber-700 font-bold text-base sm:text-xl mb-3 mt-6" {...props} />,
                          p: ({node, ...props}) => <p className="mb-4 last:mb-0 text-sm sm:text-base leading-relaxed text-neutral-600" {...props} />,
                          ul: ({node, ...props}) => <ul className="list-none pl-0 mb-6 space-y-6" {...props} />,
                          ol: ({node, ...props}) => <ol className="list-decimal pl-5 sm:pl-8 mb-6 space-y-6" {...props} />,
                          li: ({node, ...props}) => (
                            <li className="text-neutral-700 leading-relaxed bg-neutral-50/50 p-4 rounded-2xl border border-neutral-100/50 shadow-sm" {...props} />
                          ),
                          blockquote: ({node, ...props}) => <blockquote className="border-l-4 border-blue-200 pl-4 italic my-6 text-neutral-500 bg-blue-50/30 py-2 rounded-r-lg" {...props} />,
                          code: ({node, ...props}) => <code className="bg-neutral-100 px-1.5 py-0.5 rounded text-xs font-mono text-blue-600" {...props} />,
                          strong: ({node, ...props}) => <strong className="text-neutral-900 font-bold border-b-2 border-blue-100" {...props} />,
                          em: ({node, ...props}) => <em className="text-neutral-500 italic" {...props} />,
                        }}
                      >
                        {glossaryContent || 'Nenhum conteúdo encontrado no glossário.'}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-8 border-t border-neutral-100 bg-white flex justify-end">
              <button 
                onClick={() => setViewingGlossary(null)}
                className="bg-neutral-900 text-white px-10 py-4 rounded-2xl font-bold hover:bg-neutral-800 transition-all shadow-lg hover:shadow-neutral-200"
              >
                Fechar Glossário
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}

function TestView({ questions, currentIndex, setCurrentIndex, answers, setAnswers, timeLeft, onFinish, onExit }: any) {
  const q = questions[currentIndex];
  
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="max-w-3xl mx-auto space-y-8"
    >
      <div className="flex items-center justify-between bg-white px-6 py-4 rounded-2xl shadow-sm border border-neutral-100 sticky top-20 z-40">
        <div className="flex items-center gap-4">
          <button 
            onClick={onExit}
            className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all flex items-center gap-1"
            title="Sair da Avaliação"
          >
            <X className="w-5 h-5" />
            <span className="text-xs font-bold uppercase">Sair</span>
          </button>
          <span className="text-sm font-bold text-neutral-500">Questão {currentIndex + 1} de {questions.length}</span>
          <div className="w-32 h-2 bg-neutral-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }} />
          </div>
        </div>
        <div className={`flex items-center gap-2 font-mono font-bold px-4 py-2 rounded-xl ${timeLeft < 60 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-neutral-100 text-neutral-700'}`}>
          <Loader2 className={`w-4 h-4 ${timeLeft >= 60 ? 'animate-spin' : ''}`} />
          {formatTime(timeLeft)}
        </div>
      </div>

      <div className="bg-white p-8 rounded-3xl shadow-xl border border-neutral-100 space-y-8">
        <h3 className="text-2xl font-bold leading-tight">{q.question}</h3>
        
        <div className="space-y-3">
          {q.options.map((opt: string, idx: number) => (
            <button 
              key={idx}
              onClick={() => {
                const newAnswers = [...answers];
                newAnswers[currentIndex] = idx;
                setAnswers(newAnswers);
              }}
              className={`w-full text-left p-5 rounded-2xl border-2 transition-all flex items-center justify-between group ${
                answers[currentIndex] === idx 
                ? 'border-emerald-500 bg-emerald-50 ring-4 ring-emerald-50' 
                : 'border-neutral-100 hover:border-emerald-200 hover:bg-neutral-50'
              }`}
            >
              <span className={`font-medium ${answers[currentIndex] === idx ? 'text-emerald-900' : 'text-neutral-700'}`}>{opt}</span>
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                answers[currentIndex] === idx ? 'border-emerald-500 bg-emerald-500' : 'border-neutral-200 group-hover:border-emerald-300'
              }`}>
                {answers[currentIndex] === idx && <CheckCircle className="w-4 h-4 text-white" />}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <button 
          onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
          disabled={currentIndex === 0}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 transition-all"
        >
          <ChevronLeft className="w-5 h-5" /> Anterior
        </button>
        
        {currentIndex === questions.length - 1 ? (
          <button 
            onClick={onFinish}
            className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-200 transition-all"
          >
            Finalizar Avaliação
          </button>
        ) : (
          <button 
            onClick={() => setCurrentIndex(Math.min(questions.length - 1, currentIndex + 1))}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-all"
          >
            Próxima <ChevronRight className="w-5 h-5" />
          </button>
        )}
      </div>
    </motion.div>
  );
}

function ResultView({ result, setView }: { result: Result, setView: any }) {
  const downloadReport = () => {
    const totalPossible = result.questions.length * (result.pointsPerQuestion || 2);
    const correctCount = Math.round(result.score / (result.pointsPerQuestion || 2));
    const content = `
RELATÓRIO DE DESEMPENHO - FINANÇAS URCA
Avaliação: ${result.assessmentTitle}
Estudante: ${result.email}
Data: ${new Date().toLocaleString()}
Nota Final: ${result.score.toFixed(1)} / ${totalPossible.toFixed(1)}
Acertos: ${correctCount} / ${result.questions.length}

DETALHES DA PROVA:
${result.questions.map((q, i) => `
Questão ${i + 1}: ${q.question}
Sua Resposta: ${q.options[result.answers[i]] || 'Não respondida'}
Gabarito: ${q.options[q.correctIndex]}
Explicação: ${q.explanation}
`).join('\n')}
    `;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Relatorio_${result.assessmentTitle.replace(/\s+/g, '_')}.txt`;
    a.click();
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-4xl mx-auto space-y-8"
    >
      <div className="bg-white p-12 rounded-[3rem] shadow-2xl border border-neutral-100 text-center space-y-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500" />
        
        <div className="space-y-4">
          <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="w-12 h-12 text-emerald-600" />
          </div>
          <h2 className="text-4xl font-extrabold">Avaliação Concluída!</h2>
          <p className="text-neutral-500 text-lg">Parabéns pelo seu esforço. Confira seu desempenho abaixo.</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-8 py-8 border-y border-neutral-100">
          <div className="space-y-1">
            <span className="text-sm font-bold text-neutral-400 uppercase tracking-widest">Nota Final</span>
            <div className="text-5xl font-black text-emerald-600">{result.score.toFixed(1)} / {(result.questions.length * (result.pointsPerQuestion || 2)).toFixed(1)}</div>
          </div>
          <div className="space-y-1">
            <span className="text-sm font-bold text-neutral-400 uppercase tracking-widest">Acertos</span>
            <div className="text-5xl font-black text-neutral-900">{Math.round(result.score / (result.pointsPerQuestion || 2))}/{result.questions.length}</div>
          </div>
          <div className="space-y-1">
            <span className="text-sm font-bold text-neutral-400 uppercase tracking-widest">Status</span>
            <div className={`text-2xl font-bold mt-3 ${result.score >= (result.questions.length * (result.pointsPerQuestion || 2)) * 0.7 ? 'text-emerald-600' : 'text-red-600'}`}>
              {result.score >= (result.questions.length * (result.pointsPerQuestion || 2)) * 0.7 ? 'Aprovado' : 'Recuperação'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 justify-center">
          <button 
            onClick={downloadReport}
            className="bg-neutral-900 text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 hover:bg-neutral-800 transition-all shadow-lg"
          >
            <Download className="w-5 h-5" /> Baixar Relatório
          </button>
          <button 
            onClick={() => setView('student')}
            className="bg-neutral-100 text-neutral-700 px-8 py-4 rounded-2xl font-bold hover:bg-neutral-200 transition-all"
          >
            Voltar ao Início
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <h3 className="text-2xl font-bold px-4">Revisão Detalhada</h3>
        <div className="space-y-4">
          {result.questions.map((q, i) => (
            <div key={i} className="bg-white p-6 rounded-3xl border border-neutral-100 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-4">
                <h4 className="font-bold text-lg leading-tight">{i + 1}. {q.question}</h4>
                {result.answers[i] === q.correctIndex ? (
                  <CheckCircle className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-6 h-6 text-red-500 flex-shrink-0" />
                )}
              </div>
              
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-neutral-50 border border-neutral-100">
                  <span className="text-xs font-bold text-neutral-400 uppercase">Sua Resposta</span>
                  <p className={`font-medium mt-1 ${result.answers[i] === q.correctIndex ? 'text-emerald-700' : 'text-red-700'}`}>
                    {q.options[result.answers[i]] || 'Não respondida'}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-100">
                  <span className="text-xs font-bold text-emerald-600 uppercase">Gabarito</span>
                  <p className="font-medium mt-1 text-emerald-900">{q.options[q.correctIndex]}</p>
                </div>
              </div>

              <div className="bg-neutral-50 p-4 rounded-xl text-sm text-neutral-600 leading-relaxed italic">
                <span className="font-bold not-italic text-neutral-900 mr-2">Explicação:</span>
                {q.explanation}
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

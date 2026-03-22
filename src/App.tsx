import React, { useState, useRef, useEffect } from "react";
import { 
  MessageSquareText, 
  Sparkles, 
  Copy, 
  Trash2, 
  Loader2, 
  Info,
  ChevronRight,
  CheckCircle2,
  Briefcase,
  LayoutList,
  PlusCircle,
  Image as ImageIcon,
  X,
  Users,
  Mic,
  MessageCircle,
  Send,
  UserPlus,
  UserMinus,
  History as HistoryIcon,
  LogOut,
  LogIn,
  ChevronDown,
  Calendar,
  FileDown,
  AlertTriangle,
  Search
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { 
  summarizeChat, 
  transcribeAudio, 
  summarizeHistory, 
  generateGroupMessageFromHistory,
  type SummaryMode 
} from "./services/gemini";
import { cn } from "./lib/utils";
import { auth, db } from "./firebase";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  type User
} from "firebase/auth";
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  getDocFromServer
} from "firebase/firestore";

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-red-50">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-red-100 text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 mx-auto">
              <Info size={32} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Ops! Algo deu errado.</h2>
            <p className="text-gray-600">Ocorreu um erro inesperado na aplicação.</p>
            <pre className="text-xs bg-gray-50 p-4 rounded-xl overflow-auto text-left max-h-40">
              {this.state.error?.message || JSON.stringify(this.state.error)}
            </pre>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-red-600 text-white rounded-full font-bold hover:bg-red-700 transition-all"
            >
              Recarregar Página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Client {
  id: string;
  name: string;
  createdAt: any;
  uid: string;
}

interface HistoryRecord {
  id: string;
  clientId: string;
  mode: SummaryMode;
  content: string;
  createdAt: any;
  uid: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [clientHistories, setClientHistories] = useState<HistoryRecord[]>([]);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historySummary, setHistorySummary] = useState<string | null>(null);
  const [groupMessage, setGroupMessage] = useState<string | null>(null);
  const [isSummarizingHistory, setIsSummarizingHistory] = useState(false);
  const [isGeneratingGroupMessage, setIsGeneratingGroupMessage] = useState(false);
  
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: 'danger' | 'warning';
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    type: 'warning'
  });
  
  type DateFilterType = "all" | "today" | "yesterday" | "7days" | "30days" | "custom" | "specific";
  const [historyDateFilter, setHistoryDateFilter] = useState<DateFilterType>("all");
  const [specificDate, setSpecificDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  
  const selectedClient = clients.find(c => c.id === selectedClientId);
  
  // State for the filters that are currently active in the view
  const [appliedDateFilter, setAppliedDateFilter] = useState<{
    type: DateFilterType;
    specificDate: string;
    customStartDate: string;
    customEndDate: string;
  }>({
    type: "all",
    specificDate: new Date().toISOString().split('T')[0],
    customStartDate: "",
    customEndDate: ""
  });
  
  const [chatTexts, setChatTexts] = useState<Record<SummaryMode, string>>({
    communication: "",
    account_actions: "",
    group_update: "",
    client_response: ""
  });
  const [summaries, setSummaries] = useState<Record<SummaryMode, string | null>>({
    communication: null,
    account_actions: null,
    group_update: null,
    client_response: null
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<SummaryMode>("communication");
  const [image, setImage] = useState<{ data: string; mimeType: string; preview: string } | null>(null);
  const [audio, setAudio] = useState<{ data: string; mimeType: string; fileName: string } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  
  const resultRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Test Connection
  useEffect(() => {
    if (isAuthReady && user) {
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }
      };
      testConnection();
    }
  }, [isAuthReady, user]);

  // Fetch Clients
  useEffect(() => {
    if (!user) {
      setClients([]);
      return;
    }

    const q = query(
      collection(db, "clients"),
      where("uid", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const clientsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Client[];
      setClients(clientsData);
    }, (error) => {
      console.error("Error fetching clients:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // Fetch History for selected client
  useEffect(() => {
    if (!user || !selectedClientId) {
      setClientHistories([]);
      return;
    }

    const q = query(
      collection(db, "histories"),
      where("clientId", "==", selectedClientId),
      where("uid", "==", user.uid),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const historyData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as HistoryRecord[];
      setClientHistories(historyData);
    }, (error) => {
      console.error("Error fetching history:", error);
    });

    return () => unsubscribe();
  }, [user, selectedClientId]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Login error:", err);
      setError("Falha ao entrar com Google.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSelectedClientId("");
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  const handleAddClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newClientName.trim()) return;

    try {
      await addDoc(collection(db, "clients"), {
        name: newClientName.trim(),
        createdAt: serverTimestamp(),
        uid: user.uid
      });
      setNewClientName("");
      setIsClientModalOpen(false);
    } catch (err) {
      console.error("Error adding client:", err);
      setError("Erro ao adicionar cliente.");
    }
  };

  const handleDeleteClient = (clientId: string) => {
    if (!user) return;
    
    setConfirmModal({
      isOpen: true,
      title: "Excluir Cliente",
      message: "Tem certeza que deseja remover este cliente e TODO o seu histórico? Esta ação não pode ser desfeita.",
      type: 'danger',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, "clients", clientId));
          if (selectedClientId === clientId) setSelectedClientId("");
        } catch (err) {
          console.error("Error deleting client:", err);
          setError("Erro ao remover cliente.");
        }
      }
    });
  };

  const saveToHistory = async (content: string) => {
    if (!user || !selectedClientId) return;

    try {
      await addDoc(collection(db, "histories"), {
        clientId: selectedClientId,
        mode,
        content,
        createdAt: serverTimestamp(),
        uid: user.uid
      });
    } catch (err) {
      console.error("Error saving history:", err);
      setError("Erro ao salvar no histórico.");
    }
  };

  const handleSummarizeHistory = async () => {
    if (!user || !selectedClientId || clientHistories.length === 0) return;

    setIsSummarizingHistory(true);
    setHistorySummary(null);
    setGroupMessage(null);
    setError(null);

    try {
      const filteredHistory = getFilteredHistory();
      if (filteredHistory.length === 0) {
        setError("Nenhum registro encontrado para o período selecionado.");
        return;
      }

      const periodText = appliedDateFilter.type === "today" ? "hoje" :
                        appliedDateFilter.type === "yesterday" ? "ontem" :
                        appliedDateFilter.type === "7days" ? "últimos 7 dias" :
                        appliedDateFilter.type === "30days" ? "últimos 30 dias" :
                        appliedDateFilter.type === "custom" ? `de ${appliedDateFilter.customStartDate} até ${appliedDateFilter.customEndDate}` :
                        appliedDateFilter.type === "specific" ? `do dia ${appliedDateFilter.specificDate}` : "todo o período";

      const records = filteredHistory.map(h => ({
        mode: h.mode,
        content: h.content,
        createdAt: h.createdAt?.toDate().toLocaleString('pt-BR') || ""
      }));

      const summary = await summarizeHistory(records, periodText);
      setHistorySummary(summary);
    } catch (err) {
      console.error("Error summarizing history:", err);
      setError("Falha ao gerar o resumo do histórico.");
    } finally {
      setIsSummarizingHistory(false);
    }
  };

  const handleGenerateGroupMessage = async () => {
    if (!historySummary) return;

    setIsGeneratingGroupMessage(true);
    setGroupMessage(null);
    setError(null);

    try {
      const message = await generateGroupMessageFromHistory(historySummary);
      setGroupMessage(message);
    } catch (err) {
      console.error("Error generating group message:", err);
      setError("Falha ao gerar a mensagem para o grupo.");
    } finally {
      setIsGeneratingGroupMessage(false);
    }
  };

  const handleExportPDF = async () => {
    const element = document.getElementById("history-summary-content");
    if (!element) return;

    try {
      setLoading(true);
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff",
        onclone: (clonedDoc) => {
          const clonedElement = clonedDoc.getElementById("history-summary-content");
          if (clonedElement) {
            // Force standard colors for the container
            clonedElement.style.backgroundColor = "#ffffff";
            clonedElement.style.color = "#111827";
            
            // Recursively clean up all elements in the clone
            const allElements = clonedElement.getElementsByTagName("*");
            for (let i = 0; i < allElements.length; i++) {
              const el = allElements[i] as HTMLElement;
              
              // Force standard colors for common properties to bypass oklch issues
              const computedStyle = window.getComputedStyle(el);
              
              if (computedStyle.color.includes("oklch")) {
                el.style.color = "#374151";
              }
              if (computedStyle.backgroundColor.includes("oklch")) {
                el.style.backgroundColor = "transparent";
              }
              if (computedStyle.borderColor.includes("oklch")) {
                el.style.borderColor = "#e5e7eb";
              }
              
              // Specific overrides for known elements
              if (el.tagName === "H2" || el.tagName === "H1" || el.tagName === "H3") {
                el.style.color = "#111827";
              }
              if (el.tagName === "P" || el.tagName === "LI") {
                el.style.color = "#374151";
              }
            }
          }
        }
      });
      
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
      const fileName = `Resumo_${clients.find(c => c.id === selectedClientId)?.name || "Cliente"}_${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.pdf`;
      pdf.save(fileName);
    } catch (err) {
      console.error("Error exporting PDF:", err);
      setError("Falha ao exportar PDF: Verifique se há cores modernas não suportadas.");
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilter = () => {
    setAppliedDateFilter({
      type: historyDateFilter,
      specificDate,
      customStartDate,
      customEndDate
    });
  };

  const parseLocalDate = (dateStr: string) => {
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  };

  const getFilteredHistory = () => {
    if (appliedDateFilter.type === "all") return clientHistories;

    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (appliedDateFilter.type === "today") {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    } else if (appliedDateFilter.type === "yesterday") {
      startDate = new Date();
      startDate.setDate(now.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      endDate.setDate(now.getDate() - 1);
      endDate.setHours(23, 59, 59, 999);
    } else if (appliedDateFilter.type === "7days") {
      startDate = new Date();
      startDate.setDate(now.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      endDate.setDate(now.getDate() - 1);
      endDate.setHours(23, 59, 59, 999);
    } else if (appliedDateFilter.type === "30days") {
      startDate = new Date();
      startDate.setDate(now.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      endDate.setDate(now.getDate() - 1);
      endDate.setHours(23, 59, 59, 999);
    } else if (appliedDateFilter.type === "custom") {
      startDate = parseLocalDate(appliedDateFilter.customStartDate);
      endDate = parseLocalDate(appliedDateFilter.customEndDate);
      if (endDate) endDate.setHours(23, 59, 59, 999);
    } else if (appliedDateFilter.type === "specific") {
      startDate = parseLocalDate(appliedDateFilter.specificDate);
      if (startDate) startDate.setHours(0, 0, 0, 0);
      endDate = parseLocalDate(appliedDateFilter.specificDate);
      if (endDate) endDate.setHours(23, 59, 59, 999);
    }

    return clientHistories.filter(h => {
      const date = h.createdAt?.toDate();
      if (!date) return false;
      if (startDate && date < startDate) return false;
      if (endDate && date > endDate) return false;
      return true;
    });
  };

  const handleClearHistory = async (modeToClear?: SummaryMode) => {
    if (!user || !selectedClientId) return;
    
    const title = modeToClear ? "Limpar Categoria" : "Limpar Histórico";
    const message = modeToClear 
      ? `Tem certeza que deseja apagar todo o histórico de ${modeToClear === "communication" ? "Comunicados" : modeToClear === "account_actions" ? "Ações da Conta" : modeToClear === "group_update" ? "Atualizações" : "Respostas"} deste cliente?`
      : "Tem certeza que deseja apagar TODO o histórico deste cliente? Esta ação não pode ser desfeita.";

    setConfirmModal({
      isOpen: true,
      title,
      message,
      type: 'danger',
      onConfirm: async () => {
        try {
          const historiesToDelete = clientHistories.filter(h => !modeToClear || h.mode === modeToClear);
          for (const h of historiesToDelete) {
            await deleteDoc(doc(db, "histories", h.id));
          }
        } catch (err) {
          console.error("Error clearing history:", err);
          setError("Erro ao limpar histórico.");
        }
      }
    });
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsTranscribing(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64String = (reader.result as string).split(',')[1];
          try {
            const transcription = await transcribeAudio({
              data: base64String,
              mimeType: 'audio/webm'
            });
            
            if (transcription) {
              setChatTexts(prev => {
                const currentText = prev[mode];
                const separator = currentText.trim() ? "\n\n" : "";
                return {
                  ...prev,
                  [mode]: currentText + separator + transcription
                };
              });
            }
          } catch (err) {
            console.error("Transcription error:", err);
            setError("Falha ao transcrever o áudio. Tente novamente.");
          } finally {
            setIsTranscribing(false);
          }
        };
        reader.onerror = () => {
          setIsTranscribing(false);
          setError("Erro ao processar o áudio gravado.");
        };
        reader.readAsDataURL(audioBlob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSummarize = async () => {
    const currentText = chatTexts[mode];
    if (!currentText.trim() && !image && !audio) {
      setError("Por favor, forneça dados (texto, imagem ou áudio) para análise.");
      return;
    }

    setLoading(true);
    setError(null);
    setSummaries(prev => ({ ...prev, [mode]: null }));

    try {
      const result = await summarizeChat(
        currentText, 
        mode, 
        image ? { data: image.data, mimeType: image.mimeType } : undefined,
        audio ? { data: audio.data, mimeType: audio.mimeType } : undefined
      );
      const finalResult = result || "Não foi possível gerar um resumo.";
      setSummaries(prev => ({ ...prev, [mode]: finalResult }));
      
      // Auto-save to history if client is selected
      if (selectedClientId && user) {
        await saveToHistory(finalResult);
      }

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ocorreu um erro inesperado.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    const currentSummary = summaries[mode];
    if (currentSummary && resultRef.current) {
      try {
        let plainText = currentSummary;
        
        // WhatsApp uses * for bold instead of **
        if (mode === "group_update" || mode === "client_response") {
          plainText = plainText
            .replace(/\*\*(.*?)\*\*/g, '*$1*')
            .replace(/__(.*?)__/g, '*$1*');
        }

        const htmlContent = resultRef.current.innerHTML;

        const blobHtml = new Blob([htmlContent], { type: "text/html" });
        const blobText = new Blob([plainText], { type: "text/plain" });
        
        const data = [new ClipboardItem({
          ["text/html"]: blobHtml,
          ["text/plain"]: blobText,
        })];

        await navigator.clipboard.write(data);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Rich copy failed, falling back to text:", err);
        let plainText = currentSummary;
        if (mode === "group_update" || mode === "client_response") {
          plainText = plainText
            .replace(/\*\*(.*?)\*\*/g, '*$1*')
            .replace(/__(.*?)__/g, '*$1*');
        }
        navigator.clipboard.writeText(plainText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const handleClear = () => {
    setChatTexts(prev => ({ ...prev, [mode]: "" }));
    setSummaries(prev => ({ ...prev, [mode]: null }));
    setError(null);
    setImage(null);
    setAudio(null);
  };

  const handleClearAll = () => {
    setChatTexts({
      communication: "",
      account_actions: "",
      group_update: "",
      client_response: ""
    });
    setSummaries({
      communication: null,
      account_actions: null,
      group_update: null,
      client_response: null
    });
    setError(null);
    setImage(null);
    setAudio(null);
  };

  const handleNewSummarization = () => {
    setSummaries(prev => ({ ...prev, [mode]: null }));
    setChatTexts(prev => ({ ...prev, [mode]: "" }));
    setError(null);
    setImage(null);
    setAudio(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        setImage({
          data: base64String,
          mimeType: file.type,
          preview: reader.result as string
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        setAudio({
          data: base64String,
          mimeType: file.type,
          fileName: file.name
        });
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle paste for images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf("image") !== -1) {
            const file = items[i].getAsFile();
            if (file) {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64String = (reader.result as string).split(',')[1];
                setImage({
                  data: base64String,
                  mimeType: file.type,
                  preview: reader.result as string
                });
              };
              reader.readAsDataURL(file);
            }
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#f5f5f5] text-[#1a1a1a] font-sans selection:bg-emerald-100 selection:text-emerald-900">
        {/* Header */}
        <header className="bg-white border-b border-black/5 sticky top-0 z-20">
          <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white">
                <MessageSquareText size={20} />
              </div>
              <h1 className="font-semibold text-lg tracking-tight hidden sm:block">Atualizações de parceiros</h1>
            </div>
            
            <div className="flex items-center gap-4">
              {isAuthReady && (
                user ? (
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end hidden sm:flex">
                      <span className="text-sm font-bold">{user.displayName}</span>
                      <span className="text-[10px] text-gray-500">{user.email}</span>
                    </div>
                    <button 
                      onClick={handleLogout}
                      className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                      title="Sair"
                    >
                      <LogOut size={20} />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={handleLogin}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-black/10 rounded-full text-sm font-bold hover:bg-gray-50 transition-all shadow-sm"
                  >
                    <LogIn size={18} />
                    Entrar com Google
                  </button>
                )
              )}
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-12 space-y-12">
          {/* Hero Section */}
          <section className="text-center space-y-4">
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Gestão estratégica <br />
              <span className="text-emerald-600">em segundos.</span>
            </h2>
            <p className="text-lg text-[#9e9e9e] max-w-2xl mx-auto">
              Transforme conversas, áudios e prints de Ads em atualizações profissionais e respostas estratégicas para seus clientes.
            </p>
          </section>

          {/* Client Selection & Management */}
          {user && (
            <section className="bg-white rounded-3xl p-6 shadow-sm border border-black/5 space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Users size={20} className="text-emerald-500" />
                    {selectedClient ? selectedClient.name : "Selecione o Cliente"}
                  </h3>
                  <p className="text-xs text-gray-500">O histórico será salvo automaticamente para o cliente selecionado.</p>
                </div>
                <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto flex-1">
                  <ClientSelector 
                    clients={clients}
                    selectedClientId={selectedClientId}
                    onSelect={setSelectedClientId}
                  />
                  <button 
                    onClick={() => setIsClientModalOpen(true)}
                    className="p-2.5 bg-emerald-500 text-white rounded-2xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                    title="Adicionar Cliente"
                  >
                    <UserPlus size={20} />
                  </button>
                  {selectedClientId && (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => handleClearHistory()}
                        className="p-2.5 bg-white border border-orange-100 text-orange-500 rounded-2xl hover:bg-orange-50 transition-all"
                        title="Limpar Todo o Histórico"
                      >
                        <Trash2 size={20} />
                      </button>
                      <button 
                        onClick={() => handleDeleteClient(selectedClientId)}
                        className="p-2.5 bg-white border border-red-100 text-red-500 rounded-2xl hover:bg-red-50 transition-all"
                        title="Remover Cliente"
                      >
                        <UserMinus size={20} />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {selectedClientId && (
                <div className="pt-4 border-t border-black/5 flex items-center justify-between">
                  <button 
                    onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                    className="flex items-center gap-2 text-sm font-bold text-emerald-600 hover:text-emerald-700 transition-colors"
                  >
                    <HistoryIcon size={18} />
                    {isHistoryOpen ? "Ocultar Histórico" : "Ver Histórico do Cliente"}
                    <span className="bg-emerald-100 px-2 py-0.5 rounded-full text-[10px]">{clientHistories.length}</span>
                  </button>
                </div>
              )}

              {/* History View */}
              {isHistoryOpen && selectedClientId && (
                <div className="space-y-8 animate-in slide-in-from-top-4 duration-300">
                  {/* History Filters & Summary Tools */}
                  <div className="bg-gray-50 rounded-2xl p-6 border border-black/5 space-y-6">
                    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                      <div className="space-y-4 flex-1">
                        <label className="text-xs font-bold uppercase text-gray-400 block">Filtrar por Período</label>
                        <div className="flex flex-wrap gap-2">
                          {[
                            { id: "all", label: "Tudo" },
                            { id: "today", label: "Hoje" },
                            { id: "yesterday", label: "Ontem" },
                            { id: "7days", label: "Últimos 7 dias" },
                            { id: "30days", label: "Últimos 30 dias" },
                            { id: "specific", label: "Datas específicas" },
                            { id: "custom", label: "Personalizado" }
                          ].map(filter => (
                            <button
                              key={filter.id}
                              onClick={() => {
                                setHistoryDateFilter(filter.id as any);
                                // Automatically apply for non-input filters
                                if (["all", "today", "yesterday", "7days", "30days"].includes(filter.id)) {
                                  setAppliedDateFilter(prev => ({ ...prev, type: filter.id as any }));
                                }
                              }}
                              className={cn(
                                "px-4 py-2 rounded-full text-xs font-bold transition-all",
                                historyDateFilter === filter.id 
                                  ? "bg-emerald-500 text-white shadow-sm" 
                                  : "bg-white border border-black/5 text-gray-500 hover:bg-gray-100"
                              )}
                            >
                              {filter.label}
                            </button>
                          ))}
                        </div>

                        {(historyDateFilter === "specific" || historyDateFilter === "custom") && (
                          <div className="flex flex-col sm:flex-row sm:items-center gap-4 animate-in fade-in slide-in-from-left-2">
                            {historyDateFilter === "specific" ? (
                              <input 
                                type="date" 
                                value={specificDate}
                                onChange={(e) => setSpecificDate(e.target.value)}
                                className="px-4 py-2 bg-white border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                              />
                            ) : (
                              <div className="flex items-center gap-2">
                                <input 
                                  type="date" 
                                  value={customStartDate}
                                  onChange={(e) => setCustomStartDate(e.target.value)}
                                  className="px-4 py-2 bg-white border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                                />
                                <span className="text-gray-400">até</span>
                                <input 
                                  type="date" 
                                  value={customEndDate}
                                  onChange={(e) => setCustomEndDate(e.target.value)}
                                  className="px-4 py-2 bg-white border border-black/5 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                                />
                              </div>
                            )}
                            <button
                              onClick={handleApplyFilter}
                              className="px-6 py-2 bg-emerald-100 text-emerald-700 rounded-xl text-xs font-bold hover:bg-emerald-200 transition-all"
                            >
                              Aplicar Filtro
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={handleSummarizeHistory}
                          disabled={isSummarizingHistory || clientHistories.length === 0}
                          className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white rounded-2xl text-sm font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                        >
                          {isSummarizingHistory ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                          Gerar Resumo do Período
                        </button>
                        <button
                          onClick={() => handleClearHistory()}
                          className="flex items-center gap-2 px-6 py-3 bg-white border border-red-100 text-red-500 rounded-2xl text-sm font-bold hover:bg-red-50 transition-all"
                        >
                          <Trash2 size={16} />
                          Limpar Tudo
                        </button>
                      </div>
                    </div>

                    {/* History Summary Result */}
                    {historySummary && (
                      <div className="bg-white rounded-2xl p-6 border border-emerald-100 space-y-6 animate-in zoom-in-95 duration-300">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-emerald-900 flex items-center gap-2">
                            <CheckCircle2 size={18} className="text-emerald-500" />
                            Relatório Executivo Gerado
                          </h4>
                          <div className="flex gap-2">
                            <button
                              onClick={handleExportPDF}
                              className="flex items-center gap-2 px-4 py-2 bg-white border border-emerald-200 text-emerald-700 rounded-full text-xs font-bold hover:bg-emerald-50 transition-all"
                            >
                              <FileDown size={14} />
                              Exportar PDF
                            </button>
                            <button
                              onClick={handleGenerateGroupMessage}
                              disabled={isGeneratingGroupMessage}
                              className="flex items-center gap-2 px-4 py-2 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold hover:bg-emerald-200 transition-all"
                            >
                              {isGeneratingGroupMessage ? <Loader2 className="animate-spin" size={14} /> : <MessageCircle size={14} />}
                              Gerar Mensagem p/ Grupo
                            </button>
                            <button
                              onClick={() => setHistorySummary(null)}
                              className="p-2 text-gray-400 hover:text-gray-600"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        </div>
                        
                        <div 
                          id="history-summary-content" 
                          className="p-8 rounded-2xl shadow-sm pdf-export-safe"
                          style={{ backgroundColor: '#ffffff', border: '1px solid #f3f4f6', color: '#111827' }}
                        >
                          <div className="mb-8 pb-6 flex items-center justify-between" style={{ borderBottom: '1px solid #f3f4f6' }}>
                            <div>
                              <h2 className="text-2xl font-bold" style={{ color: '#111827' }}>Relatório de Atividades</h2>
                              <p className="text-sm" style={{ color: '#6b7280' }}>Cliente: {clients.find(c => c.id === selectedClientId)?.name}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-bold uppercase" style={{ color: '#059669' }}>Período</p>
                              <p className="text-sm font-medium" style={{ color: '#374151' }}>
                                {appliedDateFilter.type === "today" ? "Hoje" :
                                 appliedDateFilter.type === "yesterday" ? "Ontem" :
                                 appliedDateFilter.type === "7days" ? "Últimos 7 dias" :
                                 appliedDateFilter.type === "30days" ? "Últimos 30 dias" :
                                 appliedDateFilter.type === "custom" ? `${appliedDateFilter.customStartDate} a ${appliedDateFilter.customEndDate}` :
                                 appliedDateFilter.type === "specific" ? `${appliedDateFilter.specificDate}` : "Todo o período"}
                              </p>
                            </div>
                          </div>
                          <div className="prose prose-sm max-w-none" style={{ color: '#374151' }}>
                            <ReactMarkdown>{historySummary}</ReactMarkdown>
                          </div>
                        </div>

                        {groupMessage && (
                          <div className="mt-6 pt-6 border-t border-emerald-50 space-y-4 animate-in slide-in-from-top-2">
                            <div className="flex items-center justify-between">
                              <h5 className="text-xs font-bold uppercase tracking-widest text-emerald-600">Mensagem Sugerida para WhatsApp</h5>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(groupMessage);
                                  setCopied(true);
                                  setTimeout(() => setCopied(false), 2000);
                                }}
                                className="flex items-center gap-1 text-xs font-bold text-emerald-500 hover:underline"
                              >
                                {copied ? "Copiado!" : "Copiar Mensagem"}
                              </button>
                            </div>
                            <div className="bg-emerald-50/50 p-4 rounded-xl text-sm text-gray-700 whitespace-pre-wrap border border-emerald-100/50">
                              {groupMessage}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Categorized History Boxes */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                      { id: "communication", label: "Comunicados (Monday)", icon: LayoutList, color: "blue" },
                      { id: "account_actions", label: "Ações da Conta (Monday)", icon: Briefcase, color: "purple" },
                      { id: "group_update", label: "Atualizações de Grupo", icon: Users, color: "emerald" },
                      { id: "client_response", label: "Respostas ao Cliente", icon: MessageCircle, color: "orange" }
                    ].map(category => {
                      const filtered = getFilteredHistory().filter(h => h.mode === category.id);
                      return (
                        <div key={category.id} className="bg-white rounded-3xl border border-black/5 overflow-hidden flex flex-col shadow-sm">
                          <div className={cn(
                            "px-6 py-4 flex items-center justify-between border-b border-black/5",
                            category.color === "blue" ? "bg-blue-50/50" :
                            category.color === "purple" ? "bg-purple-50/50" :
                            category.color === "emerald" ? "bg-emerald-50/50" :
                            "bg-orange-50/50"
                          )}>
                            <div className="flex items-center gap-2">
                              <category.icon size={18} className={cn(
                                category.color === "blue" ? "text-blue-500" :
                                category.color === "purple" ? "text-purple-500" :
                                category.color === "emerald" ? "text-emerald-500" :
                                "text-orange-500"
                              )} />
                              <h4 className="font-bold text-sm">{category.label}</h4>
                              <span className="bg-white px-2 py-0.5 rounded-full text-[10px] font-bold border border-black/5">
                                {filtered.length}
                              </span>
                            </div>
                            {filtered.length > 0 && (
                              <button 
                                onClick={() => handleClearHistory(category.id as any)}
                                className="text-gray-400 hover:text-red-500 transition-colors"
                                title="Limpar esta categoria"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                          
                          <div className="flex-1 p-4 space-y-4 max-h-[400px] overflow-y-auto custom-scrollbar bg-gray-50/30">
                            {filtered.length === 0 ? (
                              <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-2 opacity-40">
                                <category.icon size={32} />
                                <p className="text-xs">Nenhum registro</p>
                              </div>
                            ) : (
                              filtered.map(record => (
                                <div key={record.id} className="bg-white rounded-2xl p-4 border border-black/5 space-y-2 group relative shadow-sm hover:shadow-md transition-all">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-1 text-[10px] text-gray-400 font-medium">
                                      <Calendar size={10} />
                                      {record.createdAt?.toDate().toLocaleString('pt-BR')}
                                    </div>
                                    <button 
                                      onClick={() => {
                                        setConfirmModal({
                                          isOpen: true,
                                          title: "Remover Registro",
                                          message: "Tem certeza que deseja remover este registro do histórico?",
                                          type: 'danger',
                                          onConfirm: async () => {
                                            try {
                                              await deleteDoc(doc(db, "histories", record.id));
                                            } catch (err) {
                                              console.error("Error deleting record:", err);
                                              setError("Erro ao remover registro.");
                                            }
                                          }
                                        });
                                      }}
                                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                  <div className="prose prose-sm max-w-none text-xs text-gray-600 line-clamp-4">
                                    <ReactMarkdown>{record.content}</ReactMarkdown>
                                  </div>
                                  <button 
                                    onClick={() => {
                                      setMode(record.mode);
                                      setSummaries(prev => ({ ...prev, [record.mode]: record.content }));
                                      setIsHistoryOpen(false);
                                      window.scrollTo({ top: 0, behavior: "smooth" });
                                    }}
                                    className="text-[10px] font-bold text-emerald-600 hover:underline"
                                  >
                                    Ver completo
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Client Modal */}
          {isClientModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
              <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl space-y-6 animate-in zoom-in-95 duration-300">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold">Novo Cliente</h3>
                  <button onClick={() => setIsClientModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={24} />
                  </button>
                </div>
                <form onSubmit={handleAddClient} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase text-gray-400">Nome do Cliente</label>
                    <input 
                      type="text" 
                      autoFocus
                      value={newClientName}
                      onChange={(e) => setNewClientName(e.target.value)}
                      placeholder="Ex: Empresa ABC"
                      className="w-full px-4 py-3 bg-gray-50 border border-black/5 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={!newClientName.trim()}
                    className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-bold hover:bg-emerald-600 transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                  >
                    Adicionar Cliente
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Mode Selection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            onClick={() => setMode("communication")}
            className={cn(
              "flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-2xl font-medium transition-all border text-center",
              mode === "communication" 
                ? "bg-white text-emerald-600 shadow-sm border-emerald-100 ring-1 ring-emerald-100" 
                : "bg-white/50 text-[#9e9e9e] hover:text-[#1a1a1a] border-transparent hover:bg-white"
            )}
          >
            <LayoutList size={24} />
            <span className="text-sm">Comunicado (Monday)</span>
          </button>
          <button
            onClick={() => setMode("account_actions")}
            className={cn(
              "flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-2xl font-medium transition-all border text-center",
              mode === "account_actions" 
                ? "bg-white text-emerald-600 shadow-sm border-emerald-100 ring-1 ring-emerald-100" 
                : "bg-white/50 text-[#9e9e9e] hover:text-[#1a1a1a] border-transparent hover:bg-white"
            )}
          >
            <Briefcase size={24} />
            <span className="text-sm">Ações da conta (Monday)</span>
          </button>
          <button
            onClick={() => setMode("group_update")}
            className={cn(
              "flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-2xl font-medium transition-all border text-center",
              mode === "group_update" 
                ? "bg-white text-emerald-600 shadow-sm border-emerald-100 ring-1 ring-emerald-100" 
                : "bg-white/50 text-[#9e9e9e] hover:text-[#1a1a1a] border-transparent hover:bg-white"
            )}
          >
            <Users size={24} />
            <span className="text-sm">Enviar mensagem de atualização</span>
          </button>
          <button
            onClick={() => setMode("client_response")}
            className={cn(
              "flex flex-col items-center justify-center gap-2 px-4 py-6 rounded-2xl font-medium transition-all border text-center",
              mode === "client_response" 
                ? "bg-white text-emerald-600 shadow-sm border-emerald-100 ring-1 ring-emerald-100" 
                : "bg-white/50 text-[#9e9e9e] hover:text-[#1a1a1a] border-transparent hover:bg-white"
            )}
          >
            <MessageCircle size={24} />
            <span className="text-sm">Responder Mensagem</span>
          </button>
        </div>

        <div className="text-center text-xs text-[#9e9e9e] -mt-8 space-y-1">
          <p>
            <strong>Comunicado (Monday):</strong> Resumo executivo para histórico do projeto. | 
            <strong> Ações da conta (Monday):</strong> Lista técnica de tarefas e ajustes realizados.
          </p>
          <p>
            <strong>Enviar mensagem de atualização:</strong> Quando você inicia a conversa ou envia um feedback. | 
            <strong> Responder Mensagem:</strong> Quando você responde a uma mensagem do cliente.
          </p>
        </div>

        {/* Input Area */}
        <div className="bg-white rounded-3xl shadow-sm border border-black/5 overflow-hidden transition-all duration-300 focus-within:shadow-md focus-within:border-emerald-200">
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <label htmlFor="chat-input" className="text-sm font-semibold uppercase tracking-wider text-[#9e9e9e] flex items-center gap-2">
                <ChevronRight size={14} className="text-emerald-500" />
                {mode === "client_response" 
                  ? "O que você quer dizer ao cliente? (Texto ou Áudio)" 
                  : mode === "account_actions" || mode === "group_update" 
                    ? "Cole a conversa ou print das campanhas" 
                    : "Cole a conversa aqui"}
              </label>
              <div className="flex items-center gap-3">
                {Object.values(chatTexts).some(text => text.trim() !== "") && (
                  <button 
                    onClick={handleClearAll}
                    className="text-[#9e9e9e] hover:text-red-600 transition-colors flex items-center gap-1 text-sm font-medium border border-black/5 px-3 py-1 rounded-full bg-white hover:bg-red-50"
                  >
                    <Trash2 size={14} />
                    Limpar Tudo
                  </button>
                )}
                {(chatTexts[mode] || image || audio) && (
                  <button 
                    onClick={handleClear}
                    className="text-[#9e9e9e] hover:text-red-500 transition-colors flex items-center gap-1 text-sm font-medium"
                  >
                    <Trash2 size={14} />
                    Limpar Atual
                  </button>
                )}
              </div>
            </div>
            
            <div className="relative">
              <textarea
                id="chat-input"
                className="w-full h-64 p-4 bg-[#f9f9f9] rounded-2xl border-none focus:ring-2 focus:ring-emerald-500/20 resize-none font-mono text-sm leading-relaxed outline-none transition-all"
                placeholder={mode === "client_response"
                  ? "Ex: O cliente está preocupado com o ROAS. Diga que estamos ajustando os criativos e que o acompanhamento é diário..."
                  : mode === "account_actions" || mode === "group_update"
                    ? "Cole o log da conversa ou dê Ctrl+V em um print do Meta/Google Ads..." 
                    : "[10:30, 21/03/2024] João: Vamos marcar a reunião?..."}
                value={chatTexts[mode]}
                onChange={(e) => setChatTexts(prev => ({ ...prev, [mode]: e.target.value }))}
              />

              {/* Transcribing Indicator Overlay */}
              {isTranscribing && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-4 animate-in fade-in duration-300 z-10">
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
                    <Loader2 className="animate-spin" size={24} />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-gray-900">Transcrevendo...</p>
                    <p className="text-xs text-gray-500">Transformando áudio em texto</p>
                  </div>
                </div>
              )}

              {/* Recording Indicator Overlay */}
              {isRecording && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-4 animate-in fade-in duration-300 z-10">
                  <div className="relative">
                    <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center text-red-600 animate-pulse">
                      <Mic size={40} />
                    </div>
                    <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-bold text-gray-900">{formatTime(recordingTime)}</p>
                    <p className="text-sm text-gray-500">Gravando sua mensagem...</p>
                  </div>
                  <button 
                    onClick={stopRecording}
                    className="mt-4 px-8 py-3 bg-red-500 text-white rounded-full font-bold hover:bg-red-600 transition-all shadow-lg shadow-red-500/20 active:scale-95"
                  >
                    Parar Gravação
                  </button>
                </div>
              )}
              
              {/* Image Preview Overlay */}
              {image && (
                <div className="absolute bottom-4 left-4 right-4 flex items-center gap-4 p-3 bg-white/90 backdrop-blur rounded-xl border border-emerald-100 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-black/5">
                    <img src={image.preview} alt="Preview" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setImage(null)}
                      className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-emerald-900 truncate">Imagem anexada</p>
                    <p className="text-[10px] text-emerald-600">Será analisada junto com o texto</p>
                  </div>
                </div>
              )}

              {/* Audio Preview Overlay */}
              {audio && (
                <div className={cn(
                  "absolute left-4 right-4 flex items-center gap-4 p-3 bg-white/90 backdrop-blur rounded-xl border border-emerald-100 shadow-sm animate-in fade-in slide-in-from-bottom-2",
                  image ? "bottom-24" : "bottom-4"
                )}>
                  <div className="relative w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 border border-emerald-200">
                    <Mic size={20} />
                    <button 
                      onClick={() => setAudio(null)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600 transition-colors shadow-sm"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-emerald-900 truncate">{audio.fileName}</p>
                    <p className="text-[10px] text-emerald-600">Áudio pronto para transcrição e análise</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex flex-1 gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-4 px-4 rounded-2xl font-semibold border-2 border-dashed border-emerald-100 text-emerald-600 hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <ImageIcon size={18} />
                  Anexar Print
                </button>
                <button
                  onClick={startRecording}
                  disabled={isRecording}
                  className="flex-1 py-4 px-4 rounded-2xl font-semibold border-2 border-dashed border-emerald-100 text-emerald-600 hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <Mic size={18} />
                  Gravar Áudio
                </button>
                <button
                  onClick={() => audioInputRef.current?.click()}
                  className="flex-1 py-4 px-4 rounded-2xl font-semibold border-2 border-dashed border-emerald-100 text-emerald-600 hover:bg-emerald-50 transition-all flex items-center justify-center gap-2 text-sm"
                >
                  <PlusCircle size={18} />
                  Anexar Áudio
                </button>
              </div>
              
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageUpload} 
                accept="image/*" 
                className="hidden" 
              />
              <input 
                type="file" 
                ref={audioInputRef} 
                onChange={handleAudioUpload} 
                accept="audio/*" 
                className="hidden" 
              />
              
              <button
                onClick={handleSummarize}
                disabled={loading || (!chatTexts[mode].trim() && !image && !audio)}
                className={cn(
                  "flex-[1.5] py-4 rounded-2xl font-semibold text-lg flex items-center justify-center gap-2 transition-all duration-300",
                  loading || (!chatTexts[mode].trim() && !image && !audio)
                    ? "bg-[#e5e5e5] text-[#9e9e9e] cursor-not-allowed" 
                    : "bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
                )}
              >
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Processando...
                  </>
                ) : (
                  <>
                    <Sparkles size={20} />
                    {mode === "account_actions" 
                      ? "Gerar Relatório" 
                      : mode === "group_update"
                        ? "Gerar Atualização"
                        : mode === "client_response"
                          ? "Gerar Resposta"
                          : "Gerar Comunicado (Monday)"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-4">
            <Info className="shrink-0 mt-0.5" size={18} />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Results Section */}
        {summaries[mode] && (
          <div className="space-y-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-bold tracking-tight">
                {mode === "account_actions" 
                  ? "Ações Específicas da Conta" 
                  : mode === "group_update"
                    ? "Enviar mensagem de atualização"
                    : mode === "client_response"
                      ? "Responder Mensagem"
                      : "Comunicado no grupo (Monday)"}
              </h3>
              <div className="flex gap-2">
                <button 
                  onClick={handleNewSummarization}
                  className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-white border border-black/5 hover:bg-gray-50 text-[#1a1a1a] transition-all"
                >
                  <PlusCircle size={16} />
                  Novo
                </button>
                <button 
                  onClick={handleCopy}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
                    copied 
                      ? "bg-emerald-100 text-emerald-700" 
                      : "bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm"
                  )}
                >
                  {copied ? (
                    <>
                      <CheckCircle2 size={16} />
                      Copiado!
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      {mode === "group_update" || mode === "client_response" ? "Copiar para WhatsApp" : "Copiar para Monday"}
                    </>
                  )}
                </button>
              </div>
            </div>
            <div 
              ref={resultRef}
              className="bg-white rounded-3xl p-8 shadow-sm border border-black/5 prose prose-emerald max-w-none markdown-body"
            >
              <ReactMarkdown>{summaries[mode] || ""}</ReactMarkdown>
            </div>
          </div>
        )}

        {/* Instructions */}
        <section className="bg-emerald-50 rounded-3xl p-8 border border-emerald-100 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-600 shadow-sm">
              <Info size={24} />
            </div>
            <h3 className="text-xl font-bold text-emerald-900">Como otimizar seu trabalho</h3>
          </div>
          <div className="grid sm:grid-cols-4 gap-6">
            {[
              { step: "1", title: "Prints de Ads", desc: "Tire prints das métricas do Meta ou Google Ads." },
              { step: "2", title: "Áudios do Cliente", desc: "Anexe áudios com briefings ou feedbacks para transcrição automática." },
              { step: "3", title: "Contexto Extra", desc: "Cole conversas de texto para complementar a análise." },
              { step: "4", title: "Relatório Pronto", desc: "Gere atualizações profissionais em segundos." }
            ].map((item) => (
              <div key={item.step} className="space-y-2">
                <div className="text-3xl font-bold text-emerald-200">{item.step}</div>
                <h4 className="font-bold text-emerald-900">{item.title}</h4>
                <p className="text-sm text-emerald-700/80 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="pt-12 pb-6 border-t border-black/5 text-center space-y-4">
          <p className="text-sm text-[#9e9e9e]">
            Privacidade em primeiro lugar: Suas conversas e imagens são processadas com segurança.
          </p>
          <div className="flex justify-center gap-6">
            <a href="#" className="text-xs font-semibold uppercase tracking-widest text-[#9e9e9e] hover:text-emerald-500 transition-colors">Termos</a>
            <a href="#" className="text-xs font-semibold uppercase tracking-widest text-[#9e9e9e] hover:text-emerald-500 transition-colors">Privacidade</a>
            <a href="#" className="text-xs font-semibold uppercase tracking-widest text-[#9e9e9e] hover:text-emerald-500 transition-colors">Contato</a>
          </div>
        </footer>
        {/* Confirmation Modal */}
        <ConfirmationModal 
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          type={confirmModal.type}
          onConfirm={() => {
            confirmModal.onConfirm();
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          }}
          onCancel={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        />
      </main>
    </div>
    </ErrorBoundary>
  );
}

const ConfirmationModal = ({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onCancel, 
  type 
}: { 
  isOpen: boolean; 
  title: string; 
  message: string; 
  onConfirm: () => void; 
  onCancel: () => void; 
  type: 'danger' | 'warning' 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-black/5 space-y-6 animate-in zoom-in-95 duration-300">
        <div className={cn(
          "w-16 h-16 rounded-full flex items-center justify-center mx-auto",
          type === 'danger' ? "bg-red-100 text-red-600" : "bg-orange-100 text-orange-600"
        )}>
          <AlertTriangle size={32} />
        </div>
        
        <div className="text-center space-y-2">
          <h3 className="text-xl font-bold text-gray-900">{title}</h3>
          <p className="text-gray-500 text-sm leading-relaxed">{message}</p>
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={onConfirm}
            className={cn(
              "w-full py-3 rounded-full font-bold text-white transition-all shadow-lg",
              type === 'danger' ? "bg-red-600 hover:bg-red-700 shadow-red-500/20" : "bg-orange-500 hover:bg-orange-600 shadow-orange-500/20"
            )}
          >
            Confirmar
          </button>
          <button
            onClick={onCancel}
            className="w-full py-3 bg-gray-100 text-gray-600 rounded-full font-bold hover:bg-gray-200 transition-all"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

const ClientSelector = ({ 
  clients, 
  selectedClientId, 
  onSelect 
}: { 
  clients: Client[]; 
  selectedClientId: string; 
  onSelect: (id: string) => void; 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [confirmSelection, setConfirmSelection] = useState<Client | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedClient = clients.find(c => c.id === selectedClientId);
  
  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (client: Client | null) => {
    if (client === null) {
      onSelect("");
      setIsOpen(false);
      setSearchTerm("");
      return;
    }
    
    // If it's already selected, just close
    if (client.id === selectedClientId) {
      setIsOpen(false);
      setSearchTerm("");
      return;
    }

    setConfirmSelection(client);
  };

  const confirmAction = () => {
    if (confirmSelection) {
      onSelect(confirmSelection.id);
      setConfirmSelection(null);
      setIsOpen(false);
      setSearchTerm("");
    }
  };

  return (
    <div className="relative w-full sm:w-80" ref={dropdownRef}>
      <div 
        className={cn(
          "flex items-center gap-2 bg-gray-50 border rounded-2xl px-4 py-2.5 transition-all cursor-text",
          isOpen ? "border-emerald-500 ring-2 ring-emerald-500/10" : "border-black/5"
        )}
        onClick={() => {
          setIsOpen(true);
          inputRef.current?.focus();
        }}
      >
        <Search size={16} className="text-gray-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          className="bg-transparent border-none outline-none text-sm font-medium w-full placeholder:text-gray-400"
          placeholder={selectedClient ? selectedClient.name : "Buscar ou selecionar cliente..."}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
        />
        <ChevronDown 
          size={16} 
          className={cn(
            "text-gray-400 transition-transform duration-200 shrink-0 cursor-pointer",
            isOpen && "rotate-180"
          )} 
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
          }}
        />
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-black/5 z-[60] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="max-h-60 overflow-y-auto p-2">
            {/* Option to clear selection */}
            <button
              onClick={() => handleSelect(null)}
              className="w-full text-left px-4 py-3 rounded-xl text-sm transition-all flex items-center gap-2 text-gray-500 hover:bg-gray-50"
            >
              <X size={14} />
              <span>Nenhum (Limpar seleção)</span>
            </button>

            <div className="h-px bg-black/5 my-1" />

            {filteredClients.length > 0 ? (
              filteredClients.map(client => (
                <button
                  key={client.id}
                  onClick={() => handleSelect(client)}
                  className={cn(
                    "w-full text-left px-4 py-3 rounded-xl text-sm transition-all flex items-center justify-between group",
                    selectedClientId === client.id 
                      ? "bg-emerald-50 text-emerald-700 font-bold" 
                      : "hover:bg-gray-50 text-gray-700"
                  )}
                >
                  <span>{client.name}</span>
                  {selectedClientId === client.id && (
                    <CheckCircle2 size={14} className="text-emerald-500" />
                  )}
                </button>
              ))
            ) : (
              <div className="px-4 py-8 text-center space-y-2">
                <div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center mx-auto text-gray-400">
                  <Users size={20} />
                </div>
                <p className="text-xs text-gray-500">Nenhum cliente encontrado</p>
              </div>
            )}
          </div>
          
          {searchTerm && filteredClients.length > 0 && (
            <div className="p-2 border-t border-black/5 bg-gray-50/50">
              <p className="text-[10px] text-gray-400 text-center uppercase tracking-wider font-bold">
                Mostrando {filteredClients.length} resultados
              </p>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmSelection && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mb-4">
              <Users size={24} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Confirmar Acesso</h3>
            <p className="text-gray-500 text-sm mb-6">
              Deseja acessar os dados e o histórico do cliente <span className="font-bold text-gray-900">"{confirmSelection.name}"</span>?
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmSelection(null)}
                className="flex-1 px-4 py-3 rounded-2xl bg-gray-100 text-gray-700 font-bold hover:bg-gray-200 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={confirmAction}
                className="flex-1 px-4 py-3 rounded-2xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

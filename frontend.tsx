import { useEffect, useMemo, useState } from "react";

type UserRole = "RECEPTION" | "NURSE" | "DOCTOR";

interface Patient {
  id: string;
  patient_name: string;
  ramq_number: string;
  age: number;
  reason_for_visit: string;
  priority: string;
  temperature: string | null;
  blood_pressure: string | null;
  heart_rate: string | null;
  medical_report: any;
  status: string;
}

export default function App() {
  const API_BASE = "http://127.0.0.1:8000";

  const [role, setRole] = useState<UserRole>("RECEPTION");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);

  // Register
  const [name, setName] = useState("");
  const [ramq, setRamq] = useState("");
  const [age, setAge] = useState("");

  // Triage
  const [triageData, setTriageData] = useState({
    temp: "",
    bp: "",
    hr: "",
    reason: "",
    priority: "Routine",
  });

  // Recording
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPatients = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/patients`);
      const data = await res.json();
      setPatients(data);
    } catch (e) {
      setError("Failed to fetch patients.");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchPatients();
  }, []);

  const waitingPatients = useMemo(
    () => patients.filter((p) => p.status === "Waiting"),
    [patients]
  );
  const readyPatients = useMemo(
    () => patients.filter((p) => p.status === "Ready"),
    [patients]
  );

  // Register
  const handleRegister = async () => {
    setError(null);
    try {
      await fetch(`${API_BASE}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_name: name,
          ramq,
          age: parseInt(age),
        }),
      });
      setName("");
      setRamq("");
      setAge("");
      fetchPatients();
    } catch {
      setError("Registration failed.");
    }
  };

  // Triage
  const handleTriageSubmit = async (id: string) => {
    setError(null);
    try {
      await fetch(`${API_BASE}/triage/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(triageData),
      });
      setTriageData({ temp: "", bp: "", hr: "", reason: "", priority: "Routine" });
      fetchPatients();
    } catch {
      setError("Triage failed.");
    }
  };

  // Recording
  const startRecording = async () => {
    setError(null);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    let chunks: BlobPart[] = [];

    recorder.ondataavailable = (e) => chunks.push(e.data);

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      setAudioBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
    };

    recorder.start();
    setMediaRecorder(recorder);
    setRecording(true);
    setPaused(false);
  };

  const pauseRecording = () => {
    mediaRecorder?.pause();
    setPaused(true);
  };

  const resumeRecording = () => {
    mediaRecorder?.resume();
    setPaused(false);
  };

  const stopRecording = () => {
    mediaRecorder?.stop();
    setRecording(false);
    setPaused(false);
  };

  // Send audio to AI
  const sendRecordingToAI = async () => {
    if (!audioBlob || !selectedPatient) return;

    setAiLoading(true);
    setError(null);

    try {
      const file = new File([audioBlob], "visit.webm", { type: "audio/webm" });
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(
        `${API_BASE}/transcribe-and-soap/${selectedPatient.id}`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail || "AI failed");
        setAiLoading(false);
        return;
      }

      // Update selected patient instantly
      setSelectedPatient({
        ...selectedPatient,
        medical_report: data.soap,
      });

      fetchPatients();
    } catch {
      setError("AI generation failed.");
    }

    setAiLoading(false);
  };

  return (
    <div style={styles.dashboardContainer}>
      <nav style={styles.sidebar}>
        <div style={styles.logoSection}>
          <h1 style={styles.logoText}>VocaMed</h1>
          <div style={styles.logoSubtext}>AI Medical Scribe</div>
        </div>

        <div style={styles.navLinks}>
          <button
            onClick={() => setRole("RECEPTION")}
            style={role === "RECEPTION" ? styles.navActive : styles.navBtn}
          >
            Reception
          </button>
          <button
            onClick={() => setRole("NURSE")}
            style={role === "NURSE" ? styles.navActive : styles.navBtn}
          >
            Nurse
          </button>
          <button
            onClick={() => setRole("DOCTOR")}
            style={role === "DOCTOR" ? styles.navActive : styles.navBtn}
          >
            Doctor
          </button>
        </div>
      </nav>

      <main style={styles.mainContent}>
        <h2 style={styles.viewTitle}>{role} View</h2>

        {error && <div style={styles.errorBox}>{error}</div>}
        {loading && <div style={styles.infoBox}>Loading patients…</div>}

        {/* RECEPTION */}
        {role === "RECEPTION" && (
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Register New Patient</h3>

            <input
              style={styles.input}
              placeholder="Full Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              style={styles.input}
              placeholder="RAMQ"
              value={ramq}
              onChange={(e) => setRamq(e.target.value)}
            />
            <input
              style={styles.input}
              placeholder="Age"
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />

            <button style={styles.btnPrimary} onClick={handleRegister}>
              Register Patient
            </button>
          </div>
        )}

        {/* NURSE */}
        {role === "NURSE" &&
          waitingPatients.map((p) => (
            <div key={p.id} style={styles.card}>
              <h3 style={styles.cardTitle}>{p.patient_name}</h3>
              <div style={styles.metaRow}>
                <span style={styles.meta}>RAMQ: {p.ramq_number}</span>
                <span style={styles.meta}>Age: {p.age}</span>
              </div>

              <input
                style={styles.input}
                placeholder="Temperature"
                value={triageData.temp}
                onChange={(e) => setTriageData({ ...triageData, temp: e.target.value })}
              />
              <input
                style={styles.input}
                placeholder="Blood Pressure"
                value={triageData.bp}
                onChange={(e) => setTriageData({ ...triageData, bp: e.target.value })}
              />
              <input
                style={styles.input}
                placeholder="Heart Rate"
                value={triageData.hr}
                onChange={(e) => setTriageData({ ...triageData, hr: e.target.value })}
              />
              <input
                style={styles.input}
                placeholder="Reason for visit"
                value={triageData.reason}
                onChange={(e) => setTriageData({ ...triageData, reason: e.target.value })}
              />

              <select
                style={styles.input}
                value={triageData.priority}
                onChange={(e) => setTriageData({ ...triageData, priority: e.target.value })}
              >
                <option>Routine</option>
                <option>Urgent</option>
                <option>Emergency</option>
              </select>

              <button style={styles.btnPrimary} onClick={() => handleTriageSubmit(p.id)}>
                Submit Triage
              </button>
            </div>
          ))}

        {/* DOCTOR */}
        {role === "DOCTOR" &&
          readyPatients.map((p) => (
            <div key={p.id} style={styles.card} onClick={() => setSelectedPatient(p)}>
              <h3 style={styles.cardTitle}>{p.patient_name}</h3>
              <div style={styles.metaRow}>
                <span style={styles.meta}>Priority: {p.priority}</span>
                <span style={styles.meta}>Status: {p.status}</span>
              </div>
            </div>
          ))}

        {/* PATIENT MODAL */}
        {selectedPatient && (
          <div style={styles.modalOverlay}>
            <div style={styles.modalContent}>
              <div style={styles.modalHeader}>
                <h2>{selectedPatient.patient_name}</h2>
                <button style={styles.btnClose} onClick={() => setSelectedPatient(null)}>
                  Close
                </button>
              </div>

              <div style={styles.patientInfo}>
                <div><b>RAMQ:</b> {selectedPatient.ramq_number}</div>
                <div><b>Age:</b> {selectedPatient.age}</div>
                <div><b>Reason:</b> {selectedPatient.reason_for_visit}</div>
              </div>

                            <div style={styles.reportBox}>
                <h2 style={styles.reportTitle}>Medical Report</h2>

                {selectedPatient.medical_report ? (
                  <div>
                    <div style={styles.section}>
                      <h3 style={styles.sectionTitle}>Subjective</h3>
                      <p style={styles.sectionText}>{selectedPatient.medical_report.Subjective}</p>
                    </div>

                    <div style={styles.section}>
                      <h3 style={styles.sectionTitle}>Objective</h3>
                      <p style={styles.sectionText}>{selectedPatient.medical_report.Objective}</p>
                    </div>

                    <div style={styles.section}>
                      <h3 style={styles.sectionTitle}>Assessment</h3>
                      <p style={styles.sectionText}>{selectedPatient.medical_report.Assessment}</p>
                    </div>

                    <div style={styles.section}>
                      <h3 style={styles.sectionTitle}>Plan</h3>
                      <p style={styles.sectionText}>{selectedPatient.medical_report.Plan}</p>
                    </div>
                  </div>
                ) : (
                  <div style={styles.infoBox}>No medical report yet</div>
                )}
              </div>

              <div style={styles.recorderBox}>
                {!recording && (
                  <button style={styles.btnPrimary} onClick={startRecording}>
                    Start Recording
                  </button>
                )}

                {recording && !paused && (
                  <button style={styles.btnSecondary} onClick={pauseRecording}>
                    Pause
                  </button>
                )}

                {recording && paused && (
                  <button style={styles.btnSecondary} onClick={resumeRecording}>
                    Resume
                  </button>
                )}

                {recording && (
                  <button style={styles.btnDanger} onClick={stopRecording}>
                    Stop
                  </button>
                )}

                {audioBlob && (
                  <button style={styles.btnPrimary} onClick={sendRecordingToAI}>
                    {aiLoading ? "Generating..." : "Generate SOAP"}
                  </button>
                )}

                {audioUrl && <audio controls src={audioUrl} style={{ marginTop: 12 }} />}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const styles: any = {
  dashboardContainer: {
    display: "flex",
    height: "100vh",
    fontFamily: "Inter, sans-serif",
    background: "#f5f7fb",
  },
  sidebar: {
    width: 260,
    background: "#061a2c",
    padding: 24,
    display: "flex",
    flexDirection: "column",
  },
  logoSection: { marginBottom: 40 },
  logoText: { color: "#fff", fontSize: 28, fontWeight: 800 },
  logoSubtext: { color: "#9bbbd6", fontSize: 12, marginTop: 4 },
  navLinks: { display: "flex", flexDirection: "column", gap: 10 },
  navBtn: {
    padding: "14px 16px",
    borderRadius: 10,
    border: "none",
    color: "#b8c7d8",
    background: "transparent",
    textAlign: "left",
    cursor: "pointer",
  },
  navActive: {
    padding: "14px 16px",
    borderRadius: 10,
    border: "none",
    color: "#fff",
    background: "#2b6cb0",
    textAlign: "left",
    cursor: "pointer",
  },
  mainContent: {
    flex: 1,
    padding: 40,
    overflowY: "auto",
  },
  viewTitle: {
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 20,
    color: "#0b1b2b",
  },
  card: {
    background: "#fff",
    borderRadius: 14,
    padding: 20,
    marginBottom: 20,
    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  },
  cardTitle: { marginBottom: 12, fontSize: 18, fontWeight: 700 },
  input: {
    width: "100%",
    padding: 12,
    borderRadius: 10,
    border: "1px solid #d6dce6",
    marginBottom: 10,
  },
  btnPrimary: {
    padding: "12px 18px",
    borderRadius: 10,
    border: "none",
    background: "#0b4f8a",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
  },
  btnSecondary: {
    padding: "12px 18px",
    borderRadius: 10,
    border: "none",
    background: "#e2e8f0",
    color: "#0b1b2b",
    fontWeight: 700,
    cursor: "pointer",
    marginLeft: 10,
  },
  btnDanger: {
    padding: "12px 18px",
    borderRadius: 10,
    border: "none",
    background: "#e53e3e",
    color: "#fff",
    fontWeight: 700,
    cursor: "pointer",
    marginLeft: 10,
  },
  metaRow: { display: "flex", gap: 16, marginBottom: 12 },
  meta: { color: "#556a7a", fontWeight: 600 },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  modalContent: {
    background: "#fff",
    padding: 24,
    width: 720,
    borderRadius: 16,
    boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  btnClose: {
    border: "none",
    background: "#e2e8f0",
    padding: "10px 14px",
    borderRadius: 10,
    cursor: "pointer",
  },
  patientInfo: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 },
  reportBox: {
    background: "#f8fafc",
    padding: 16,
    borderRadius: 14,
    marginBottom: 16,
  },
  pre: { whiteSpace: "pre-wrap", fontSize: 13, color: "#0b1b2b" },
  recorderBox: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  infoBox: {
    padding: 12,
    borderRadius: 12,
    background: "#e2e8f0",
    color: "#0b1b2b",
    fontWeight: 600,
  },
  errorBox: {
    padding: 12,
    borderRadius: 12,
    background: "#ffe3e3",
    color: "#a61b1b",
    fontWeight: 700,
    marginBottom: 16,
  },
};

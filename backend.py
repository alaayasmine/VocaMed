
import json
import requests
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from openai import OpenAI
from uuid import UUID

app = FastAPI(debug=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Supabase

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# API KEYS

openai_client = OpenAI(api_key=OPENAI_API_KEY)


# Models
class PatientCreate(BaseModel):
    patient_name: str
    ramq: str
    age: int


class TriageUpdate(BaseModel):
    temp: str
    bp: str
    hr: str
    reason: str
    priority: str


# Utils
def _validate_uuid(value: str):
    try:
        UUID(value)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid patient_id (must be UUID)")


# Routes
@app.get("/")
def root():
    return {"status": "API running"}


@app.get("/patients")
def get_patients():
    res = supabase.table("encounters").select("*").execute()
    return res.data


@app.get("/patients/{patient_id}")
def get_patient(patient_id: str):
    _validate_uuid(patient_id)

    res = supabase.table("encounters").select("*").eq("id", patient_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    return res.data


@app.post("/register")
def register_patient(patient: PatientCreate):
    res = supabase.table("encounters").insert({
        "patient_name": patient.patient_name,
        "ramq_number": patient.ramq,
        "age": patient.age,
        "temperature": None,
        "blood_pressure": None,
        "heart_rate": None,
        "reason_for_visit": "Pending triage",
        "priority": "Routine",
        "medical_report": None,
        "status": "Waiting"
    }).execute()

    return res.data


@app.put("/triage/{patient_id}")
def triage_patient(patient_id: str, triage: TriageUpdate):
    _validate_uuid(patient_id)

    res = (
        supabase.table("encounters")
        .update({
            "temperature": triage.temp,
            "blood_pressure": triage.bp,
            "heart_rate": triage.hr,
            "reason_for_visit": triage.reason,
            "priority": triage.priority,
            "status": "Ready"
        })
        .eq("id", patient_id)
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    return res.data


@app.delete("/discharge/{patient_id}")
def discharge_patient(patient_id: str):
    _validate_uuid(patient_id)

    res = supabase.table("encounters").delete().eq("id", patient_id).execute()
    return res.data



# Transcribe + SOAP (MAIN PIPELINE)
@app.post("/transcribe-and-soap/{patient_id}")
async def transcribe_and_soap(patient_id: str, file: UploadFile = File(...)):
    _validate_uuid(patient_id)

    # Verify patient exists
    patient = supabase.table("encounters").select("id").eq("id", patient_id).execute()
    if not patient.data:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Transcribe with ElevenLabs
    try:
        headers = {"xi-api-key": ELEVENLABS_API_KEY}
        audio_bytes = await file.read()

        files = {
            "file": (file.filename, audio_bytes, file.content_type or "audio/webm")
        }

        data = {
            "model_id": "scribe_v2",
            "diarization": True
        }

        response = requests.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers=headers,
            files=files,
            data=data,
            timeout=60
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"ElevenLabs request failed: {e}")

    if response.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail=f"ElevenLabs error: {response.text}"
        )
    transcript = response.json()

    print("ELEVENLABS RESPONSE:", json.dumps(transcript, indent=2))

    segments = transcript.get("segments")
    text = transcript.get("text")

    if segments:
        formatted_text = ""
        for seg in segments:
            speaker = seg.get("speaker") or seg.get("speaker_id") or "Speaker"
            text_seg = seg.get("text", "")
            formatted_text += f"{speaker}: {text_seg}\n"

    elif text:
        formatted_text = text

    else:
        raise HTTPException(status_code=400, detail=f"Empty transcription: {transcript}")

    # Generate SOAP with OpenAI
    try:
        soap_response = openai_client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a medical scribe. "
                        "Return ONLY valid JSON with keys: "
                        "Subjective, Objective, Assessment, Plan."
                    )
                },
                {
                    "role": "user",
                    "content": formatted_text
                }
            ],
            temperature=0
        )

        soap_text = soap_response.choices[0].message.content

        # Remove possible surrounding quotes
        soap_text = soap_text.strip()

        # If the model returns JSON wrapped in quotes, fix it
        if soap_text.startswith('"') and soap_text.endswith('"'):
            soap_text = soap_text[1:-1]

        # Convert the JSON string into a python dict
        soap_json = json.loads(soap_text)

        if not soap_json:
            raise HTTPException(status_code=500, detail="AI generation failed: empty response")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI error: {e}")

    # Save SOAP to Supabase
    try:
        res = supabase.table("encounters").update({
            "medical_report": soap_json
        }).eq("id", patient_id).execute()

        if not res.data:
            raise HTTPException(status_code=500, detail="Database update failed")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database update failed: {e}")

    return {
        "patient_id": patient_id,
        "soap": soap_json
    }

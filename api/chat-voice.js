export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Thiếu GEMINI_API_KEY trong Environment Variables của Vercel."
      });
    }

    const {
      message,
      history = [],
      vocabText = "",
      voiceName = "Kore"
    } = req.body || {};

    const cleanMessage = String(message || "").trim();

    if (!cleanMessage) {
      return res.status(400).json({
        error: "Thiếu nội dung message."
      });
    }

    const historyText = Array.isArray(history)
      ? history
          .slice(-10)
          .map((m) => {
            const role = m.role === "user" ? "Học viên" : "AI";
            return `${role}: ${m.content || ""}`;
          })
          .join("\n")
      : "";

    const prompt = `
Bạn là gia sư tiếng Trung thân thiện, xưng là "Thầy" và gọi người học là "Trò".

Nhiệm vụ:
- Trò chuyện tự nhiên với người học.
- Nếu người học hỏi bằng tiếng Việt, trả lời bằng tiếng Việt dễ hiểu.
- Nếu người học viết hoặc nói tiếng Trung, hãy phản hồi phù hợp bằng tiếng Trung đơn giản, kèm giải thích tiếng Việt nếu cần.
- Nếu câu tiếng Trung của người học sai, hãy sửa nhẹ nhàng.
- Khi đưa ví dụ tiếng Trung, hãy có Hán tự, pinyin và nghĩa tiếng Việt.
- Có thể dùng lẫn tiếng Việt, tiếng Trung, tiếng Anh nếu phù hợp.
- Trả lời vừa đủ, không quá dài.
- Không dùng markdown quá nặng.

Từ vựng bài học hiện tại:
${vocabText || "Chưa có từ vựng bài học."}

Lịch sử trò chuyện gần đây:
${historyText || "Chưa có."}

Tin nhắn mới của học viên:
${cleanMessage}
`;

    const textAnswer = await callGeminiText(apiKey, prompt);

    let audioResult = {
      audioBase64: "",
      mimeType: ""
    };

    try {
      audioResult = await callGeminiTTS(apiKey, textAnswer, voiceName);
    } catch (ttsError) {
      console.error("Gemini TTS error:", ttsError);
    }

    return res.status(200).json({
      text: textAnswer,
      audioBase64: audioResult.audioBase64 || "",
      mimeType: audioResult.mimeType || ""
    });
  } catch (error) {
    console.error("chat-voice error:", error);

    return res.status(500).json({
      error: error.message || "Lỗi server khi gọi Gemini."
    });
  }
}

async function callGeminiText(apiKey, prompt) {
  const model = process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.6,
      topP: 0.9,
      maxOutputTokens: 1200
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Gemini text response:", data);
    throw new Error(data?.error?.message || `Không gọi được Gemini text với model ${model}.`);
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini không trả về nội dung text.");
  }

  return text;
}

async function callGeminiTTS(apiKey, text, voiceName = "Kore") {
  const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const safeText = String(text || "").slice(0, 3000);

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: safeText
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName
          }
        }
      }
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("Gemini TTS response:", data);
    throw new Error(data?.error?.message || `Không gọi được Gemini TTS với model ${model}.`);
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];

  const audioPart = parts.find((p) => p.inlineData || p.inline_data);

  const inlineData = audioPart?.inlineData || audioPart?.inline_data;

  const audioBase64 = inlineData?.data || "";
  const mimeType = inlineData?.mimeType || inlineData?.mime_type || "audio/wav";

  if (!audioBase64) {
    throw new Error("Gemini TTS không trả về audio.");
  }

  return {
    audioBase64,
    mimeType
  };
}

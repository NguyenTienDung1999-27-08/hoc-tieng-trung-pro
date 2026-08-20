module.exports = async function (req, res) {
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Chỉ chấp nhận phương thức POST"
    });
  }

  try {
    const {
      messages,
      prompt,
      temperature = 0.5,
      enableAudio = true,
      ttsOnly = false,    // <--- CÔNG TẮC CHỈ LẤY AUDIO (DÙNG CHO PHẢN XẠ)
      textToSpeak = "",   // <--- TEXT CẦN ĐỌC
      lang = "vi"         // <--- NGÔN NGỮ ĐỌC
    } = req.body || {};

    // =====================================================================
    // 1. NHÁNH XỬ LÝ RIÊNG CHO PHẦN THI PHẢN XẠ (CHỈ LẤY MP3 TỪ GOOGLE)
    // =====================================================================
    if (ttsOnly && textToSpeak) {
      const audioBuffers = [];
      const cleanText = String(textToSpeak)
        .replace(/[*_#`"“”]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!cleanText) {
        return res.status(400).json({ error: "Nội dung text trống." });
      }

      // Tận dụng hàm chunk có sẵn ở cuối file
      const chunks = splitTextIntoChunks(cleanText, 180);

      for (const chunk of chunks) {
        const textToEncode = encodeURIComponent(chunk);
        // Dùng client=tw-ob để Google không bao giờ chặn (chống lỗi 403)
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${textToEncode}`;
        
        const audioResponse = await fetch(ttsUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0"
          }
        });

        if (audioResponse.ok) {
          const arrayBuffer = await audioResponse.arrayBuffer();
          audioBuffers.push(Buffer.from(arrayBuffer));
        }
      }

      if (audioBuffers.length === 0) {
        throw new Error("Không lấy được âm thanh TTS từ Google.");
      }

      const combinedBuffer = Buffer.concat(audioBuffers);
      return res.status(200).json({
        audioBase64: combinedBuffer.toString("base64"),
        mimeType: "audio/mpeg"
      });
    }

    // =====================================================================
    // 2. NHÁNH XỬ LÝ CHAT AI BÌNH THƯỜNG (DÙNG CHO TRÒ CHUYỆN)
    // =====================================================================
    const groqKeys = getGroqKeys();

    if (groqKeys.length === 0) {
      return res.status(500).json({
        error: "Thiếu GROQ_API_KEY trên Vercel. Có thể thêm GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3..."
      });
    }

    if (!messages && !prompt) {
      return res.status(400).json({
        error: "Thiếu nội dung hội thoại."
      });
    }

    const systemInstruction = `
Bạn là gia sư tiếng Trung đang đối thoại trực tiếp với học viên.

Nhiệm vụ:
- Trả lời tự nhiên, ngắn gọn, giống 2 người đang nói chuyện.
- Nếu người dùng nói tiếng Việt, trả lời tiếng Việt là chính.
- Nếu phù hợp, dạy thêm 1 câu tiếng Trung ngắn.
- Nếu người dùng nói tiếng Trung sai, sửa nhẹ nhàng, không làm họ ngại.
- Không viết dài dòng.
- Không dùng markdown phức tạp.
- Tối đa 3 đến 5 dòng.

QUY TẮC ĐỊNH DẠNG BẮT BUỘC ĐỂ HỆ THỐNG ĐỌC GIỌNG KHÔNG BỊ LẪN:
1. Không được trộn tiếng Việt, chữ Hán và pinyin trong cùng một dòng.
2. Nếu có câu tiếng Trung, phải tách thành 3 dòng riêng:
中文: câu chữ Hán
Pinyin: pinyin
Nghĩa: nghĩa tiếng Việt
3. Dòng tiếng Việt giải thích thì chỉ viết tiếng Việt, không chen chữ Hán.
4. Dòng 中文 chỉ chứa chữ Hán và dấu câu tiếng Trung, không chen tiếng Việt hoặc pinyin.
5. Dòng Pinyin chỉ chứa pinyin latin, không chen tiếng Việt.
6. Dòng Nghĩa chỉ chứa nghĩa tiếng Việt.
7. Không viết câu kiểu: "Bạn có thể nói: 我肚子疼 (wǒ dùzi téng), nghĩa là..."
8. Nếu cần hỏi tiếp, hãy viết câu hỏi tiếp bằng tiếng Việt ở dòng riêng.

Ví dụ đúng:
Bạn bị đau bụng à? Mình học câu này nhé.
中文: 我肚子疼。
Pinyin: wǒ dùzi téng.
Nghĩa: Tôi đau bụng.
Bạn thử đọc lại câu tiếng Trung này nhé.

Ví dụ đúng:
Được chứ. Hôm nay mình luyện chủ đề mua đồ nhé.
中文: 我要买这个。
Pinyin: wǒ yào mǎi zhège.
Nghĩa: Tôi muốn mua cái này.
Bây giờ bạn thử nói một câu nhé.

Ví dụ sai, tuyệt đối không viết:
Đau bụng à, bạn có thể nói: 我肚子疼 (wǒ dùzi téng), nghĩa là "Tôi đau bụng".
`;

    let finalMessages = [
      {
        role: "system",
        content: systemInstruction
      }
    ];

    if (Array.isArray(messages) && messages.length > 0) {
      const safeMessages = messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
        .slice(-6)
        .map((m) => ({
          role: m.role,
          content: String(m.content).slice(0, 800)
        }));

      finalMessages = finalMessages.concat(safeMessages);
    } else if (prompt) {
      finalMessages.push({
        role: "user",
        content: String(prompt).slice(0, 2000)
      });
    }

    const modelCandidates = getGroqModelCandidates();

    const groqResult = await callGroqWithFallback({
      groqKeys,
      modelCandidates,
      messages: finalMessages,
      temperature
    });

    let aiText = groqResult.text;

    if (!aiText) {
      throw new Error("Groq không trả về nội dung.");
    }

    aiText = normalizeAssistantFormat(aiText);

    let audioBase64 = "";

    if (enableAudio) {
      try {
        audioBase64 = await buildGoogleTranslateAudio(aiText);
      } catch (ttsError) {
        console.warn("Lỗi Audio:", ttsError);
        audioBase64 = "";
      }
    }

    return res.status(200).json({
      result: aiText,
      audioBase64,
      mimeType: "audio/mpeg",
      usedModel: groqResult.model,
      usedKeyIndex: groqResult.keyIndex
    });

  } catch (error) {
    console.error("Lỗi Server:", error);

    return res.status(500).json({
      error: error.message || "Lỗi server."
    });
  }
};

function getGroqKeys() {
  const keys = [];

  if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY);

  for (let i = 2; i <= 10; i++) {
    const key = process.env[`GROQ_API_KEY_${i}`];
    if (key) keys.push(key);
  }

  return [...new Set(keys.filter(Boolean))];
}

function getGroqModelCandidates() {
  const fromEnv = process.env.GROQ_MODEL;

const defaultModels = [
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b"
"llama-3.1-8b-instant"
  ];
  if (!fromEnv) return defaultModels;

  const envModels = fromEnv
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  return [...new Set([...envModels, ...defaultModels])];
}

async function callGroqWithFallback({
  groqKeys,
  modelCandidates,
  messages,
  temperature
}) {
  const errors = [];

  for (let keyIndex = 0; keyIndex < groqKeys.length; keyIndex++) {
    const apiKey = groqKeys[keyIndex];

    for (const model of modelCandidates) {
      try {
        const text = await callGroqOnce({
          apiKey,
          model,
          messages,
          temperature
        });

        return {
          text,
          model,
          keyIndex: keyIndex + 1
        };
      } catch (error) {
        const msg = String(error.message || "");
        errors.push(`Key ${keyIndex + 1}, model ${model}: ${msg}`);

        const retryable =
          msg.toLowerCase().includes("rate limit") ||
          msg.toLowerCase().includes("tokens per day") ||
          msg.toLowerCase().includes("too many requests") ||
          msg.toLowerCase().includes("429") ||
          msg.toLowerCase().includes("service unavailable") ||
          msg.toLowerCase().includes("503") ||
          msg.toLowerCase().includes("timeout");

        if (!retryable) {
          console.warn("Groq non-retryable error, vẫn thử model/key tiếp:", msg);
        } else {
          console.warn("Groq retryable error, thử model/key tiếp:", msg);
        }
      }
    }
  }

  throw new Error(
    "Tất cả Groq API key hoặc model đều lỗi. Chi tiết: " +
    errors.slice(-5).join(" | ")
  );
}

async function callGroqOnce({
  apiKey,
  model,
  messages,
  temperature
}) {
  const groqUrl = "https://api.groq.com/openai/v1/chat/completions";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const textResponse = await fetch(groqUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: 2000,
        stream: false
      }),
      signal: controller.signal
    });

    const textData = await textResponse.json().catch(() => ({}));

    if (!textResponse.ok) {
      const message =
        textData?.error?.message ||
        `Groq HTTP ${textResponse.status}`;

      throw new Error(message);
    }

    const aiText = textData?.choices?.[0]?.message?.content?.trim();

    if (!aiText) {
      throw new Error("Groq không trả về nội dung.");
    }

    return aiText;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Timeout khi gọi Groq.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAssistantFormat(text) {
  let out = String(text || "").trim();

  out = out
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+$/gm, "");

  return out;
}

async function buildGoogleTranslateAudio(aiText) {
  const lines = String(aiText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const audioBuffers = [];

  for (let line of lines) {
    const segments = splitMixedLanguageLine(line);

    for (const seg of segments) {
      const cleanText = seg.text
        .replace(/[*_#`]/g, "")
        .replace(/[“”"]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (cleanText.length < 2) continue;

      const chunks = splitTextIntoChunks(cleanText, 180);

      for (const chunk of chunks) {
        const textToEncode = encodeURIComponent(chunk);
        // Thay đổi sang tw-ob ở đây luôn để ổn định cho cả phần Chat AI
        const ttsUrl =
          `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${seg.lang}&q=${textToEncode}`;

        const audioResponse = await fetch(ttsUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0"
          }
        });

        if (audioResponse.ok) {
          const arrayBuffer = await audioResponse.arrayBuffer();
          audioBuffers.push(Buffer.from(arrayBuffer));
        }
      }
    }
  }

  if (audioBuffers.length === 0) {
    return "";
  }

  const combinedBuffer = Buffer.concat(audioBuffers);
  return combinedBuffer.toString("base64");
}

function splitMixedLanguageLine(line) {
  const source = String(line || "").trim();

  if (!source) return [];

  if (/^Pinyin\s*:/i.test(source)) {
    return [];
  }

  if (/^中文\s*:/i.test(source)) {
    const chineseText = source
      .replace(/^中文\s*:/i, "")
      .replace(/\([^)]*\)/g, "")
      .replace(/（[^）]*）/g, "")
      .trim();

    return chineseText
      ? [{
          text: chineseText,
          lang: "zh-CN"
        }]
      : [];
  }

  if (/^Nghĩa\s*:/i.test(source)) {
    const meaningText = source
      .replace(/^Nghĩa\s*:/i, "")
      .trim();

    return meaningText
      ? [{
          text: meaningText,
          lang: "vi"
        }]
      : [];
  }

  const hasChinese = /[\u4e00-\u9fff]/.test(source);

  if (!hasChinese) {
    return [{
      text: removePinyinParentheses(source),
      lang: detectLatinLang(source)
    }];
  }

  const parts = [];
  const regex = /([\u4e00-\u9fff，。！？、；：“”《》（）]+)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(source)) !== null) {
    const before = source.slice(lastIndex, match.index);
    const chinese = match[0];

    const cleanBefore = removePinyinParentheses(before).trim();

    if (cleanBefore) {
      parts.push({
        text: cleanBefore,
        lang: detectLatinLang(cleanBefore)
      });
    }

    if (chinese.trim()) {
      parts.push({
        text: chinese,
        lang: "zh-CN"
      });
    }

    lastIndex = regex.lastIndex;
  }

  const rest = removePinyinParentheses(source.slice(lastIndex)).trim();

  if (rest) {
    parts.push({
      text: rest,
      lang: detectLatinLang(rest)
    });
  }

  return parts.length ? parts : [{ text: source, lang: "vi" }];
}

function removePinyinParentheses(text) {
  return String(text || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function detectLatinLang(text) {
  const s = String(text || "");

  const vietnameseChars =
    /[ăâêôơưđĂÂÊÔƠƯĐáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/;

  if (vietnameseChars.test(s)) return "vi";

  return "vi";
}

function splitTextIntoChunks(text, maxLength = 180) {
  const s = String(text || "").trim();

  if (s.length <= maxLength) return [s];

  const chunks = [];
  let current = "";

  const words = s.split(/\s+/);

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > maxLength) {
      if (current) chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);

  return chunks;
}
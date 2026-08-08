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
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Thiếu GROQ_API_KEY trên Vercel."
      });
    }

    const {
      messages,
      prompt,
      temperature = 0.55,
      enableAudio = true
    } = req.body || {};

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
- Nếu phù hợp, thêm 1 câu tiếng Trung ngắn, kèm pinyin trong ngoặc.
- Nếu người dùng nói tiếng Trung sai, sửa nhẹ nhàng, không làm họ ngại.
- Không viết dài dòng.
- Không dùng markdown phức tạp.
- Tối đa 3 đến 5 câu.
- Câu trả lời phải dễ đọc thành tiếng.

Ví dụ:
User: Hôm nay luyện mua đồ nhé
Assistant: Được chứ. Hôm nay mình luyện chủ đề mua đồ nhé. Bạn có thể nói: 我要买这个 (wǒ yào mǎi zhège) nghĩa là "Tôi muốn mua cái này". Bây giờ bạn thử nói một câu nhé.
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
        .slice(-12)
        .map((m) => ({
          role: m.role,
          content: String(m.content).slice(0, 2000)
        }));

      finalMessages = finalMessages.concat(safeMessages);
    } else if (prompt) {
      finalMessages.push({
        role: "user",
        content: String(prompt).slice(0, 4000)
      });
    }

    const groqUrl = "https://api.groq.com/openai/v1/chat/completions";

    const textResponse = await fetch(groqUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: finalMessages,
        temperature,
        stream: false
      })
    });

    const textData = await textResponse.json();

    if (!textResponse.ok) {
      throw new Error(textData?.error?.message || "Lỗi gọi API Groq.");
    }

    const aiText = textData?.choices?.[0]?.message?.content?.trim();

    if (!aiText) {
      throw new Error("Groq không trả về nội dung.");
    }

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
      mimeType: "audio/mpeg"
    });

  } catch (error) {
    console.error("Lỗi Server:", error);

    return res.status(500).json({
      error: error.message || "Lỗi server."
    });
  }
};

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
        .replace(/\s+/g, " ")
        .trim();

      if (cleanText.length < 2) continue;

      const chunks = splitTextIntoChunks(cleanText, 180);

      for (const chunk of chunks) {
        const textToEncode = encodeURIComponent(chunk);
        const ttsUrl =
          `https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&tl=${seg.lang}&q=${textToEncode}`;

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
  const source = String(line || "");
  const parts = [];

  const regex = /([\u4e00-\u9fff，。！？、；：“”《》（）]+)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(source)) !== null) {
    const before = source.slice(lastIndex, match.index);
    const chinese = match[0];

    if (before.trim()) {
      parts.push({
        text: before,
        lang: detectLatinLang(before)
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

  const rest = source.slice(lastIndex);

  if (rest.trim()) {
    parts.push({
      text: rest,
      lang: detectLatinLang(rest)
    });
  }

  return parts.length ? parts : [{ text: source, lang: "vi" }];
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

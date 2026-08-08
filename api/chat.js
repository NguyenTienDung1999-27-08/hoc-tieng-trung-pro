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

Ví dụ sai, tuyệt đối không viết:
Bạn có thể nói 我肚子疼, pinyin là wǒ dùzi téng.
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

    let aiText = textData?.choices?.[0]?.message?.content?.trim();

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
      mimeType: "audio/mpeg"
    });

  } catch (error) {
    console.error("Lỗi Server:", error);

    return res.status(500).json({
      error: error.message || "Lỗi server."
    });
  }
};

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

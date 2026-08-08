module.exports = async function (req, res) {
  // CORS config
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Chỉ chấp nhận phương thức POST" });
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Thiếu GROQ_API_KEY trên Vercel." });
    }

    const { prompt, temperature } = req.body || {};
    if (!prompt) {
      return res.status(400).json({ error: "Thiếu nội dung prompt." });
    }

    // Ép AI tách dòng rõ ràng giữa Tiếng Trung và Tiếng Việt để âm thanh không bị lẫn lộn
    const systemInstruction = `Bạn là trợ lý AI thông minh chuyên dạy tiếng Trung sinh động. 
Mỗi khi trả lời, BẮT BUỘC phải trình bày theo định dạng xuống dòng rõ rệt như sau:
[Chữ Hán] [Pinyin trong ngoặc vuông]
(Nghĩa tiếng Việt xuống dòng ở phía dưới)

Ví dụ mẫu bắt buộc:
欢迎你！ [Huānyíng nǐ!]
(Chào mừng bạn đến với lớp học!)

Tuyệt đối không gộp chung tiếng Trung và tiếng Việt vào cùng một dòng để âm thanh đọc được mạch lạc, tự nhiên.`;

    const finalPrompt = prompt + "\n\n(Lưu ý: Nhớ tuân thủ quy tắc xuống dòng riêng biệt giữa tiếng Trung và tiếng Việt).";

    const groqUrl = "https://api.groq.com/openai/v1/chat/completions";

    const textResponse = await fetch(groqUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: finalPrompt }
        ],
        temperature: temperature || 0.6,
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

    // 2. TÁCH VÀ XỬ LÝ AUDIO RIÊNG BIỆT TỪNG DÒNG (TRUNG - VIỆT)
    let audioBase64 = "";
    try {
      // Chia nhỏ văn bản theo từng dòng để xử lý tốc độ và nhịp điệu đọc chuẩn hơn
      const lines = aiText.split('\n');
      const fetchPromises = [];

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        let line = lines[lineIndex].trim();
        if (!line) continue;

        // Nhận diện dòng chứa tiếng Trung hay tiếng Việt
        const isChineseLine = /[\u4e00-\u9fff]/.test(line);
        const lang = isChineseLine ? "zh-CN" : "vi";

        // Dọn dẹp ký tự thừa để đọc mượt mà
        let cleanText = line.replace(/[*_#]/g, "");
        if (isChineseLine) {
          // Với dòng tiếng Trung, giữ lại Hán tự và Pinyin (hoặc lược bỏ Pinyin nếu Google đọc bị ngọng, ở đây giữ nguyên Hán tự là chính)
          cleanText = cleanText.replace(/\[.*?\]/g, "").trim();
        }

        if (/[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\u4e00-\u9fff]/.test(cleanText)) {
          const safeTextToRead = encodeURIComponent(cleanText.substring(0, 200));
          const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${safeTextToRead}`;
          
          fetchPromises.push(
            fetch(ttsUrl)
              .then(async (audioResponse) => {
                if (audioResponse.ok) {
                  const arrayBuffer = await audioResponse.arrayBuffer();
                  return { index: lineIndex, buffer: Buffer.from(arrayBuffer) };
                }
                return null;
              })
              .catch(() => null)
          );
        }
      }

      const fetchedResults = await Promise.all(fetchPromises);
      const validBuffers = fetchedResults
        .filter(res => res !== null && res.buffer !== null)
        .sort((a, b) => a.index - b.index)
        .map(res => res.buffer);

      if (validBuffers.length > 0) {
        const combinedBuffer = Buffer.concat(validBuffers);
        audioBase64 = combinedBuffer.toString('base64');
      }

    } catch (ttsError) {
      console.warn("Lỗi xử lý TTS dòng:", ttsError);
    }

    return res.status(200).json({
      result: aiText,          
      audioBase64: audioBase64 
    });

  } catch (error) {
    console.error("Lỗi Server:", error);
    return res.status(500).json({
      error: error.message || "Lỗi server không xác định."
    });
  }
};
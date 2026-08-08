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

    const systemInstruction = `Bạn là trợ lý AI thông minh chuyên dạy tiếng Trung. 
Mỗi khi trả lời, BẮT BUỘC tuân thủ nghiêm ngặt định dạng sau:
- PHẢI LUÔN CÓ CHỮ HÁN. Không bao giờ được bỏ quên chữ Hán.
- Cấu trúc trình bày mỗi câu/từ tiếng Trung bắt buộc phải gồm: Chữ Hán, sau đó đến Pinyin nằm trong ngoặc tròn (...).
- Nghĩa tiếng Việt đặt ở dòng riêng biệt bên dưới.

Ví dụ mẫu bắt buộc đúng 100%:
你好 (nǐ hǎo)
Xin chào bạn!

汽车 (qìchē)
Xe ô tô

Tuyệt đối không được chỉ viết mỗi Pinyin mà mất chữ Hán.`;

    const finalPrompt = prompt + "\n\n(Lưu ý: BẮT BUỘC phải có Chữ Hán kèm Pinyin trong ngoặc tròn, không được bỏ quên chữ Hán).";

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

    // 2. LỌC VÀ TÁCH CHUẨN XÁC, XÓA SẠCH NGOẶC TRÒN Pinyin KHI GỌI AUDIO
    let audioBase64 = "";
    try {
      const lines = aiText.split('\n');
      const audioBuffers = [];

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const hasChinese = /[\u4e00-\u9fff]/.test(line);
        let cleanText = line.replace(/[*_#]/g, "");

        if (hasChinese) {
          cleanText = cleanText.replace(/\(.*?\)/g, "").trim();
        }

        if (cleanText.length < 2) continue;

        const langParam = hasChinese ? 'zh-CN' : 'vi';
        const textToEncode = encodeURIComponent(cleanText.substring(0, 200));
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&tl=${langParam}&q=${textToEncode}`;
        
        const audioResponse = await fetch(ttsUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
          }
        });

        if (audioResponse.ok) {
          const arrayBuffer = await audioResponse.arrayBuffer();
          audioBuffers.push(Buffer.from(arrayBuffer));
        }
      }

      if (audioBuffers.length > 0) {
        const combinedBuffer = Buffer.concat(audioBuffers);
        audioBase64 = combinedBuffer.toString('base64');
      }

    } catch (ttsError) {
      console.warn("Lỗi Audio:", ttsError);
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
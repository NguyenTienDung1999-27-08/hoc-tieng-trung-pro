const { EdgeTTS } = require("edge-tts"); // Sử dụng thư viện edge-tts chuẩn của Microsoft

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

    const systemInstruction = `Bạn là trợ lý AI thông minh chuyên dạy tiếng Trung sinh động. 
Mỗi khi trả lời, BẮT BUỘC phải trình bày theo định dạng xuống dòng rõ rệt như sau:
[Chữ Hán] [Pinyin trong ngoặc vuông]
(Nghĩa tiếng Việt xuống dòng ở phía dưới)

Ví dụ mẫu bắt buộc:
欢迎你！ [Huānyíng nǐ!]
(Chào mừng bạn đến với lớp học!)`;

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

    // 2. TẠO ÂM THANH SIÊU MƯỢT BẰNG MICROSOFT EDGE TTS
    let audioBase64 = "";
    try {
      const lines = aiText.split('\n');
      const audioBuffers = [];

      // Chọn giọng đọc xịn xò của Microsoft: Tiếng Trung dùng giọng nữ Xiaoxiao (hoặc Yunxi), Tiếng Việt dùng giọng HoaiMy
      const zhVoice = "zh-CN-XiaoxiaoNeural"; 
      const viVoice = "vi-VN-HoaiMyNeural";

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const isChineseLine = /[\u4e00-\u9fff]/.test(line);
        const voice = isChineseLine ? zhVoice : viVoice;
        
        let cleanText = line.replace(/[*_#]/g, "");
        if (isChineseLine) {
          cleanText = cleanText.replace(/\[.*?\]/g, "").trim(); // Chỉ đọc chữ Hán cho chuẩn phát âm
        }

        if (/[a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\u4e00-\u9fff]/.test(cleanText)) {
          const tts = new EdgeTTS({
            voice: voice,
            lang: isChineseLine ? "zh-CN" : "vi-VN",
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          });

          // Tạo audio stream từ Edge TTS
          const audioBuffer = await tts.synthesize(cleanText);
          if (audioBuffer) {
            audioBuffers.push(Buffer.from(audioBuffer));
          }
        }
      }

      if (audioBuffers.length > 0) {
        const combinedBuffer = Buffer.concat(audioBuffers);
        audioBase64 = combinedBuffer.toString('base64');
      }

    } catch (ttsError) {
      console.warn("Lỗi Edge TTS:", ttsError);
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
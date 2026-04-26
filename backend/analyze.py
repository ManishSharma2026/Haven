#!/usr/bin/env python3
"""
analyze.py - Haven Image Forensics v6
Much more sensitive — catches StyleGAN2 faces.
Key fixes:
- EXIF missing from original file NOW penalized (not screenshots)
- Face detection on original size (not resized)
- Skin texture threshold loosened to catch smooth AI skin
- Symmetry threshold loosened to 5.0
- No EXIF in downloaded original = +15 AI risk
"""

import sys
import json
import os
import math
import tempfile

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False

try:
    from scipy import fftpack, stats
    SCIPY_AVAILABLE = True
except ImportError:
    SCIPY_AVAILABLE = False

try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

try:
    import c2pa
    C2PA_AVAILABLE = True
except ImportError:
    C2PA_AVAILABLE = False


class Result:
    def __init__(self):
        self.signals    = []
        self.ai_risk    = 0
        self.manip_risk = 0
        self.flags      = []
        self.details    = {}
        self.auth_count = 0

    def signal(self, msg): self.signals.append(msg)
    def ai(self, amount, reason):
        self.ai_risk = min(100, self.ai_risk + amount)
        self.flags.append(f"[AI+{amount}] {reason}")
    def manip(self, amount, reason):
        self.manip_risk = min(100, self.manip_risk + amount)
    def authentic(self, amount, reason):
        self.ai_risk = max(0, self.ai_risk - amount)
        self.auth_count += 1
        self.flags.append(f"[AUTH-{amount}] {reason}")


def stage_basic(path, r):
    try:
        ext     = os.path.splitext(path)[1].lower().replace(".", "")
        size_kb = os.path.getsize(path) / 1024
        r.details["fileType"]   = ext
        r.details["fileSizeKb"] = round(size_kb, 1)

        if PIL_AVAILABLE:
            img  = Image.open(path)
            w, h = img.size
            r.details["imageSize"]   = f"{w}x{h}"
            r.details["imageFormat"] = img.format or ext
            r.signal(f"Resolution: {w}x{h}")

            ai_sizes = [
                (512,512),(1024,1024),(768,768),(512,768),(768,512),
                (1024,512),(512,1024),(832,1216),(1216,832),(896,1152),
                (1152,896),(1344,768),(768,1344),(1536,640),(640,1536),
            ]
            if (w, h) in ai_sizes:
                r.ai(20, f"Exact AI output size: {w}x{h}")
                r.signal(f"⚠ Resolution {w}x{h} is a standard AI generation size")
            else:
                r.signal(f"✓ Resolution {w}x{h} is not a standard AI size")

            if w == h and w >= 512:
                r.ai(8, f"Perfect square ({w}x{h}) — common in GAN output")
                r.signal(f"⚠ Perfect square dimensions — common in GAN generation")

    except Exception as e:
        r.signal(f"Basic info error: {e}")


def stage_exif(path, r):
    if not PIL_AVAILABLE:
        return
    try:
        img  = Image.open(path)
        exif = img._getexif() if hasattr(img, "_getexif") else None

        if not exif:
            r.details["metadataFound"] = False
            r.ai(15, "No EXIF in downloaded original — real cameras always leave metadata")
            r.signal("⚠ No EXIF metadata — real camera photos always contain metadata")
            return

        r.details["metadataFound"] = True
        from PIL.ExifTags import TAGS
        decoded = {TAGS.get(k, k): v for k, v in exif.items()}
        make    = str(decoded.get("Make", "")).strip()
        model   = str(decoded.get("Model", "")).strip()
        software= str(decoded.get("Software", "")).strip()
        gps     = decoded.get("GPSInfo", None)

        if make or model:
            r.authentic(25, f"Real camera: {make} {model}".strip())
            r.signal(f"✓ Camera: {make} {model}".strip())
        else:
            r.ai(10, "No camera in EXIF")
            r.signal("⚠ No camera make/model in EXIF")

        if software:
            ai_sw = ["stable diffusion","midjourney","dall","firefly",
                     "imagen","generative","comfy","automatic1111","invoke"]
            if any(s in software.lower() for s in ai_sw):
                r.ai(65, f"AI software: {software}")
                r.signal(f"🚨 AI software in metadata: {software}")

        if gps:
            r.authentic(15, "GPS present")
            r.signal("✓ GPS coordinates found")

        r.details["exifCamera"] = f"{make} {model}".strip()
        r.details["exifGPS"]    = bool(gps)

    except Exception as e:
        r.signal(f"EXIF error: {e}")


def stage_c2pa(path, r):
    r.details["c2paFound"] = False
    if C2PA_AVAILABLE:
        try:
            manifest = c2pa.read_file(path, None)
            if manifest:
                r.details["c2paFound"] = True
                r.authentic(40, "C2PA verified")
                r.signal("✓ C2PA Content Credentials verified")
        except:
            pass


def stage_fft(path, r):
    if not PIL_AVAILABLE or not NUMPY_AVAILABLE:
        return
    try:
        img = Image.open(path).convert("L")
        img = img.resize((512, 512), Image.LANCZOS)
        arr = np.array(img, dtype=float)

        fft     = np.fft.fft2(arr)
        mag     = np.abs(np.fft.fftshift(fft))
        log_mag = np.log1p(mag)
        h, w    = log_mag.shape
        cy, cx  = h // 2, w // 2

        yy, xx = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
        dists  = np.sqrt((yy - cy)**2 + (xx - cx)**2)
        mask   = (dists > 15) & (dists < min(h, w) // 3)
        midband = log_mag[mask]

        if midband.size == 0:
            return

        mean_mid   = float(np.mean(midband))
        peak_count = int(np.sum(midband > mean_mid + 3.5 * float(np.std(midband))))
        peak_ratio = float(np.max(midband)) / mean_mid if mean_mid > 0 else 0

        r.details["fftPeakRatio"] = round(peak_ratio, 2)
        r.details["fftPeakCount"] = peak_count

        if peak_ratio > 7.0 and peak_count > 15:
            r.ai(30, f"Strong GAN FFT artifacts")
            r.signal(f"🚨 Strong GAN frequency fingerprint (ratio={peak_ratio:.1f})")
        elif peak_ratio > 5.0 or peak_count > 8:
            r.ai(15, "Moderate FFT artifacts")
            r.signal(f"⚠ Possible GAN frequency artifacts (ratio={peak_ratio:.1f})")
        elif peak_ratio > 3.5:
            r.ai(8, "Mild FFT irregularities")
            r.signal(f"Mild frequency irregularities (ratio={peak_ratio:.1f})")
        else:
            r.authentic(5, "Natural FFT")
            r.signal(f"✓ Frequency spectrum natural (ratio={peak_ratio:.1f})")

    except Exception as e:
        r.signal(f"FFT error: {e}")


def stage_ela(path, r):
    if not PIL_AVAILABLE or not NUMPY_AVAILABLE:
        return
    try:
        original = Image.open(path).convert("RGB")
        orig_arr = np.array(original, dtype=float)

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_path = tmp.name
        original.save(tmp_path, "JPEG", quality=92)
        resaved     = Image.open(tmp_path).convert("RGB")
        resaved_arr = np.array(resaved, dtype=float)
        os.unlink(tmp_path)

        ela      = np.abs(orig_arr - resaved_arr)
        ela_mean = float(np.mean(ela))
        ela_cv   = float(np.std(ela)) / ela_mean if ela_mean > 0 else 0

        r.details["elaMean"] = round(ela_mean, 3)
        r.details["elaCV"]   = round(ela_cv, 3)

        if ela_cv < 0.6:
            r.ai(18, f"ELA too uniform (CV={ela_cv:.2f})")
            r.signal(f"🚨 Error levels too uniform (CV={ela_cv:.2f}) — AI indicator")
        elif ela_cv < 1.2:
            r.ai(8, f"ELA slightly uniform")
            r.signal(f"⚠ Error level uniformity elevated (CV={ela_cv:.2f})")
        elif ela_cv > 2.5:
            r.manip(10, "ELA inconsistent")
            r.signal(f"⚠ Error levels inconsistent — possible manipulation")
        else:
            r.authentic(6, "ELA natural")
            r.signal(f"✓ Error level variation natural (CV={ela_cv:.2f})")

    except Exception as e:
        r.signal(f"ELA error: {e}")


def stage_noise(path, r):
    if not CV2_AVAILABLE or not NUMPY_AVAILABLE:
        return
    try:
        img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return

        img   = cv2.resize(img, (512, 512))
        noise = img.astype(np.float32) - cv2.GaussianBlur(img, (5,5), 0).astype(np.float32)

        block = 32
        h, w  = noise.shape
        nb_h, nb_w = h // block, w // block
        blocks = noise[:nb_h*block, :nb_w*block].reshape(nb_h, block, nb_w, block)
        stds   = np.std(blocks, axis=(1,3)).flatten()
        mean_n = float(np.mean(stds))
        cv_n   = float(np.std(stds)) / mean_n if mean_n > 0 else 0

        r.details["noiseCV"]   = round(cv_n, 3)
        r.details["meanNoise"] = round(mean_n, 3)

        if cv_n < 0.10:
            r.ai(20, f"Noise extremely uniform (CV={cv_n:.3f})")
            r.signal(f"🚨 Noise uniformity extreme (CV={cv_n:.3f}) — strong AI indicator")
        elif cv_n < 0.20:
            r.ai(10, f"Noise quite uniform")
            r.signal(f"⚠ Noise uniformity elevated (CV={cv_n:.3f})")
        elif cv_n > 0.80:
            r.manip(10, "Noise inconsistent")
            r.signal(f"⚠ Noise inconsistency detected")
        else:
            r.authentic(6, "Noise natural")
            r.signal(f"✓ Noise distribution natural (CV={cv_n:.3f})")

    except Exception as e:
        r.signal(f"Noise error: {e}")


def stage_statistics(path, r):
    if not PIL_AVAILABLE or not NUMPY_AVAILABLE or not SCIPY_AVAILABLE:
        return
    try:
        img  = Image.open(path).convert("RGB")
        arr  = np.array(img)

        entropies = []
        for ch in range(3):
            hist, _ = np.histogram(arr[:,:,ch].flatten(), bins=256, range=(0,256))
            norm     = hist.astype(float) / hist.sum()
            ent      = float(-np.sum(norm[norm>0] * np.log2(norm[norm>0])))
            entropies.append(ent)

        avg_ent = float(np.mean(entropies))
        r.details["histogramEntropy"] = round(avg_ent, 3)

        if avg_ent < 4.5:
            r.ai(20, f"Very low entropy ({avg_ent:.2f})")
            r.signal(f"🚨 Histogram entropy very low ({avg_ent:.2f})")
        elif avg_ent < 6.0:
            r.ai(8, f"Below-normal entropy")
            r.signal(f"⚠ Histogram entropy below normal ({avg_ent:.2f})")
        elif avg_ent > 7.0:
            r.authentic(6, "Natural entropy")
            r.signal(f"✓ Histogram entropy natural ({avg_ent:.2f})")
        else:
            r.signal(f"Histogram entropy normal ({avg_ent:.2f})")

        flat = arr[:,:,0].flatten().astype(float)
        kurt = float(stats.kurtosis(flat))
        r.details["kurtosis"] = round(kurt, 3)

        if kurt > 3.0:
            r.authentic(6, f"High kurtosis ({kurt:.2f})")
            r.signal(f"✓ Pixel kurtosis natural ({kurt:.2f})")
        elif kurt < 0.0:
            r.ai(10, f"Low kurtosis ({kurt:.2f})")
            r.signal(f"⚠ Pixel kurtosis too low ({kurt:.2f})")
        else:
            r.signal(f"Kurtosis moderate ({kurt:.2f})")

        r_ch = arr[:,:,0].flatten().astype(float)
        g_ch = arr[:,:,1].flatten().astype(float)
        idx  = np.random.choice(len(r_ch), min(5000, len(r_ch)), replace=False)
        corr = float(np.corrcoef(r_ch[idx], g_ch[idx])[0, 1])
        r.details["channelCorr"] = round(corr, 3)

        if corr > 0.975:
            r.ai(15, f"Channel correlation too high ({corr:.3f})")
            r.signal(f"🚨 RGB channels too correlated ({corr:.3f}) — AI signature")
        elif corr > 0.955:
            r.ai(6, "Channel correlation elevated")
            r.signal(f"⚠ Channel correlation elevated ({corr:.3f})")
        else:
            r.authentic(5, "Channel correlation natural")
            r.signal(f"✓ Channel correlation natural ({corr:.3f})")

    except Exception as e:
        r.signal(f"Statistics error: {e}")


def stage_face(path, r):
    if not CV2_AVAILABLE or not NUMPY_AVAILABLE:
        return
    try:
        img_bgr  = cv2.imread(path)
        if img_bgr is None:
            return

        img_gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

        faces = []
        for scale in [1.05, 1.1, 1.15, 1.2]:
            faces = cv2.CascadeClassifier(
                cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
            ).detectMultiScale(img_gray, scaleFactor=scale, minNeighbors=3, minSize=(30,30))
            if len(faces) > 0:
                break

        r.details["facesDetected"] = len(faces)

        if len(faces) == 0:
            r.signal("No frontal faces detected")
            lap = cv2.Laplacian(img_gray, cv2.CV_64F)
            var = float(np.var(lap))
            r.details["globalTextureVar"] = round(var, 2)
            if var < 150:
                r.ai(12, f"Image globally smooth (var={var:.1f})")
                r.signal(f"⚠ Image texture globally smooth (var={var:.1f}) — AI indicator")
            return

        r.signal(f"✓ {len(faces)} face(s) detected")
        fx, fy, fw, fh = faces[0]
        face_gray  = img_gray[fy:fy+fh, fx:fx+fw]
        face_color = img_bgr[fy:fy+fh, fx:fx+fw]

        lap      = cv2.Laplacian(face_gray, cv2.CV_64F)
        skin_var = float(np.var(lap))
        r.details["skinTextureVar"] = round(skin_var, 2)

        if skin_var < 50:
            r.ai(25, f"Skin extremely smooth (var={skin_var:.1f})")
            r.signal(f"🚨 Skin unnaturally smooth (var={skin_var:.1f}) — strong AI indicator")
        elif skin_var < 100:
            r.ai(12, f"Skin quite smooth (var={skin_var:.1f})")
            r.signal(f"⚠ Skin texture below normal (var={skin_var:.1f})")
        elif skin_var > 200:
            r.authentic(10, "Natural skin texture")
            r.signal(f"✓ Skin texture natural (var={skin_var:.1f})")
        else:
            r.signal(f"Skin texture moderate (var={skin_var:.1f})")

        face_rs  = cv2.resize(face_gray, (128, 128))
        left_h   = face_rs[:, :64].astype(float)
        right_h  = np.fliplr(face_rs[:, 64:]).astype(float)
        sym_diff = float(np.mean(np.abs(left_h - right_h)))
        r.details["faceSymmetry"] = round(sym_diff, 3)

        if sym_diff < 5.0:
            r.ai(25, f"Near-perfect face symmetry (diff={sym_diff:.1f})")
            r.signal(f"🚨 Face near-perfectly symmetric (diff={sym_diff:.1f}) — GAN indicator")
        elif sym_diff < 9.0:
            r.ai(10, f"High face symmetry")
            r.signal(f"⚠ Face symmetry higher than natural (diff={sym_diff:.1f})")
        elif sym_diff > 18:
            r.authentic(8, "Natural asymmetry")
            r.signal(f"✓ Natural face asymmetry (diff={sym_diff:.1f})")
        else:
            r.signal(f"Face symmetry moderate (diff={sym_diff:.1f})")

        b  = face_color[:,:,0].flatten().astype(float)
        g  = face_color[:,:,1].flatten().astype(float)
        re = face_color[:,:,2].flatten().astype(float)
        if len(b) > 10:
            corr = float(np.corrcoef(re, g)[0, 1])
            r.details["faceRGBCorr"] = round(corr, 3)
            if corr > 0.978:
                r.ai(14, f"Face RGB too correlated ({corr:.3f})")
                r.signal(f"🚨 Face channel correlation extreme ({corr:.3f})")
            elif corr > 0.960:
                r.ai(6, "Face correlation elevated")
                r.signal(f"⚠ Face channel correlation elevated ({corr:.3f})")
            else:
                r.authentic(5, "Face correlation natural")
                r.signal(f"✓ Face channel correlation natural ({corr:.3f})")

    except Exception as e:
        r.signal(f"Face analysis error: {e}")


def stage_scene(path, r):
    if not CV2_AVAILABLE or not NUMPY_AVAILABLE:
        return
    try:
        img  = cv2.imread(path)
        if img is None:
            return

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(float)
        h, w = gray.shape
        grid = 6
        cell_h, cell_w = h // grid, w // grid
        variances = []
        for row in range(grid):
            for col in range(grid):
                cell = gray[row*cell_h:(row+1)*cell_h, col*cell_w:(col+1)*cell_w]
                if cell.size > 0:
                    variances.append(float(np.var(cell)))

        if variances:
            mean_v = float(np.mean(variances))
            cv_var = float(np.std(variances)) / mean_v if mean_v > 0 else 0
            r.details["sceneCV"] = round(cv_var, 3)

            if cv_var > 1.2:
                r.authentic(10, "Complex scene")
                r.signal(f"✓ Scene complexity high (CV={cv_var:.2f})")
            elif cv_var > 0.6:
                r.signal(f"Scene complexity moderate (CV={cv_var:.2f})")
            else:
                r.ai(10, "Scene too uniform")
                r.signal(f"⚠ Scene uniformity high (CV={cv_var:.2f}) — AI indicator")

        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        hue_hist, _ = np.histogram(hsv[:,:,0].flatten(), bins=18, range=(0,180))
        hue_norm = hue_hist / hue_hist.sum()
        distinct = int(np.sum(hue_norm > 0.03))
        r.details["distinctColors"] = distinct

        if distinct >= 6:
            r.authentic(8, f"Rich color diversity ({distinct})")
            r.signal(f"✓ Color diversity high ({distinct} regions)")
        elif distinct >= 4:
            r.signal(f"Color diversity moderate ({distinct} regions)")
        else:
            r.ai(8, f"Low color diversity ({distinct})")
            r.signal(f"⚠ Color diversity low ({distinct} regions)")

    except Exception as e:
        r.signal(f"Scene error: {e}")


def build_verdict(r):
    ai    = r.ai_risk
    manip = r.manip_risk

    if r.auth_count >= 4:
        ai = max(0, ai - 12)
    elif r.auth_count >= 3:
        ai = max(0, ai - 6)

    r.details["finalAiRisk"]    = ai
    r.details["authenticCount"] = r.auth_count

    if ai >= 55:
        status = "Possibly AI-Generated"
        level  = "danger"
        expl   = f"Haven detected strong AI generation signals (risk score {ai}/100). Multiple forensic checks flagged this image as inconsistent with a real photograph."
    elif manip >= 55:
        status = "Suspicious"
        level  = "warning"
        expl   = f"Haven detected manipulation signals (score {manip}/100)."
    elif ai >= 35:
        status = "Suspicious"
        level  = "warning"
        expl   = f"Haven found AI indicators (risk score {ai}/100). Treat with caution."
    elif ai < 20 and manip < 15:
        status = "Likely Real"
        level  = "safe"
        expl   = f"Haven found no strong AI generation signals (risk score {ai}/100). This image appears consistent with a real photograph."
    else:
        status = "Unclear"
        level  = "warning"
        expl   = f"Haven's analysis was inconclusive (AI risk {ai}/100)."

    libs = []
    if PIL_AVAILABLE:   libs.append("pillow")
    if NUMPY_AVAILABLE: libs.append("numpy")
    if SCIPY_AVAILABLE: libs.append("scipy")
    if CV2_AVAILABLE:   libs.append("opencv")
    if C2PA_AVAILABLE:  libs.append("c2pa")

    return {
        "status":           status,
        "level":            level,
        "confidence":       max(0, min(100, 100 - ai // 2)),
        "aiGeneratedRisk":  ai,
        "manipulationRisk": manip,
        "explanation":      expl,
        "signalsDetected":  r.signals,
        "flags":            r.flags,
        "technicalDetails": {**r.details, "modelUsed": "haven-forensics-v6 (" + ", ".join(libs) + ")"},
    }


def analyze(path):
    r = Result()
    stage_basic(path, r)
    stage_exif(path, r)
    stage_c2pa(path, r)
    stage_fft(path, r)
    stage_ela(path, r)
    stage_noise(path, r)
    stage_statistics(path, r)
    stage_face(path, r)
    stage_scene(path, r)
    return build_verdict(r)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No image path provided"}))
        sys.exit(1)
    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(json.dumps({"error": f"File not found: {image_path}"}))
        sys.exit(1)
    try:
        result = analyze(image_path)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({
            "status": "Scan Failed", "confidence": 0,
            "aiGeneratedRisk": 0, "manipulationRisk": 0,
            "explanation": f"Analysis failed: {str(e)}",
            "signalsDetected": [], "flags": [],
            "technicalDetails": {"modelUsed": "error"},
        }))
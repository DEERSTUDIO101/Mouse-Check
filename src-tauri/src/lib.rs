use hidapi::HidApi;
use serde::Serialize;
use std::ffi::CStr;
use std::thread;
use std::time::Duration;
use tauri_plugin_updater::UpdaterExt;

const RAZER_VID: u16 = 0x1532;
const HYPERPOLLING_VID: u16 = 0x31E3;
const TX_IDS: [u8; 3] = [0xFF, 0x3F, 0x1F];

const KNOWN_BRANDS: &[(u16, &str)] = &[
    (0x1532, "Razer"),
    (0x31E3, "HyperPolling"),
    (0x046D, "Logitech"),
    (0x1038, "SteelSeries"),
    (0x1B1C, "Corsair"),
    (0x0951, "HyperX"),
    (0x0B05, "ASUS ROG"),
    (0x1E7D, "Roccat"),
    (0x258A, "Glorious / SinoWealth"),
    (0x30FA, "SinoWealth"),
    (0x1770, "Zowie / BenQ"),
    (0x093A, "Pixart"),
    (0x0416, "Winbond / Pulsar"),
    (0x3367, "Endgame Gear"),
    (0x0C45, "Microdia / Redragon"),
    (0x1BCF, "Sunplus / Alienware"),
];

fn brand_for(vid: u16) -> String {
    KNOWN_BRANDS.iter()
        .find(|(v, _)| *v == vid)
        .map(|(_, b)| b.to_string())
        .unwrap_or_else(|| format!("VID {:04X}", vid))
}

fn open_path_str(api: &HidApi, path: &str) -> Option<hidapi::HidDevice> {
    let s = format!("{}\0", path);
    let c = CStr::from_bytes_with_nul(s.as_bytes()).ok()?.to_owned();
    api.open_path(&c).ok()
}

#[derive(Serialize, Clone)]
pub struct HidDeviceInfo {
    pub vendor_id: u16,
    pub product_id: u16,
    pub product: String,
    pub manufacturer: String,
    pub brand: String,
    pub razer_testable: bool,
    pub usage_page: u16,
    pub usage: u16,
    pub interface: i32,
    pub hardware_id: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct IfaceAccessResult {
    pub accessible: bool,
    pub has_feature_report: bool,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TxResult {
    pub tx_id: u8,
    pub ok: bool,
    pub firmware: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct InterfaceResult {
    pub interface: i32,
    pub usage_page: u16,
    pub usage: u16,
    pub iface_type: String,
    // Razer scan: populated, generic scan: empty
    pub results: Vec<TxResult>,
    // Generic scan only
    pub access: Option<IfaceAccessResult>,
}

#[derive(Serialize, Clone)]
pub struct DeviceReport {
    pub vendor_id: u16,
    pub product_id: u16,
    pub name: String,
    pub scan_type: String, // "razer" | "generic"
    pub interfaces: Vec<InterfaceResult>,
    // Razer only
    pub winner_tx: Option<u8>,
    pub winner_firmware: Option<String>,
    pub winner_iface: Option<i32>,
    pub winner_iface_type: Option<String>,
    // "likely" | "workaround" | "native_only" | "unknown"
    pub webid_status: String,
}

// ─── Razer packet helpers ───────────────────────────────────────────────────

fn build_packet(tx_id: u8) -> Vec<u8> {
    let mut p = vec![0u8; 91];
    p[0] = 0x00; p[2] = tx_id; p[6] = 0x02; p[7] = 0x00; p[8] = 0x81;
    let mut cs: u8 = 0;
    for i in 3..89 { cs ^= p[i]; }
    p[89] = cs;
    p
}

fn try_tx(device: &hidapi::HidDevice, tx_id: u8) -> TxResult {
    let pkt = build_packet(tx_id);
    for _ in 0..6 {
        if device.send_feature_report(&pkt).is_err() {
            return TxResult { tx_id, ok: false, firmware: None, error: Some("no_feature_report_channel".into()) };
        }
        thread::sleep(Duration::from_millis(120));
        let mut buf = vec![0u8; 91];
        buf[0] = 0x00;
        match device.get_feature_report(&mut buf) {
            Err(e) => return TxResult { tx_id, ok: false, firmware: None, error: Some(e.to_string()) },
            Ok(_) => {
                let status = buf[1]; let echo_tx = buf[2];
                let echo_class = buf[7]; let echo_cmd = buf[8];
                if echo_tx != tx_id || echo_class != 0x00 || echo_cmd != 0x81 { continue; }
                match status {
                    0x01 => { thread::sleep(Duration::from_millis(80)); continue; }
                    0x02 => return TxResult {
                        tx_id, ok: true,
                        firmware: Some(format!("v{}.{}", buf[9], buf[10])),
                        error: None,
                    },
                    s => return TxResult {
                        tx_id, ok: false, firmware: None,
                        error: Some(match s {
                            0x03 => "failure", 0x04 => "timeout",
                            0x05 => "unsupported", _ => "unknown",
                        }.into()),
                    },
                }
            }
        }
    }
    TxResult { tx_id, ok: false, firmware: None, error: Some("timeout".into()) }
}

// ─── Commands ──────────────────────────────────────────────────────────────

#[tauri::command]
fn list_devices() -> Result<Vec<HidDeviceInfo>, String> {
    let api = HidApi::new().map_err(|e| e.to_string())?;
    let known_vids: std::collections::HashSet<u16> = KNOWN_BRANDS.iter().map(|(v, _)| *v).collect();
    let devices = api.device_list()
        .filter(|d| known_vids.contains(&d.vendor_id()))
        .map(|d| {
            let vid = d.vendor_id();
            let iface = d.interface_number();
            let hw_id = if iface >= 0 {
                format!("HID\\VID_{:04X}&PID_{:04X}&MI_{:02X}", vid, d.product_id(), iface as u8)
            } else {
                format!("HID\\VID_{:04X}&PID_{:04X}", vid, d.product_id())
            };
            HidDeviceInfo {
                vendor_id: vid,
                product_id: d.product_id(),
                product: d.product_string().unwrap_or("Unknown").to_string(),
                manufacturer: d.manufacturer_string().unwrap_or("").to_string(),
                brand: brand_for(vid),
                razer_testable: vid == RAZER_VID || vid == HYPERPOLLING_VID,
                usage_page: d.usage_page(),
                usage: d.usage(),
                interface: iface,
                hardware_id: hw_id,
                path: d.path().to_string_lossy().to_string(),
            }
        })
        .collect();
    Ok(devices)
}

#[tauri::command]
fn run_full_test(pid: u16, vid: u16) -> Result<DeviceReport, String> {
    let api = HidApi::new().map_err(|e| e.to_string())?;

    if vid != RAZER_VID && vid != HYPERPOLLING_VID {
        return run_generic_scan(&api, pid, vid);
    }

    // ── Razer / HyperPolling scan ────────────────────────────────────────
    let all: Vec<_> = api.device_list()
        .filter(|d| d.vendor_id() == vid && d.product_id() == pid)
        .collect();
    if all.is_empty() {
        return Err(format!("No device found for VID {:04X} PID {:04X}", vid, pid));
    }

    let name = all[0].product_string().unwrap_or("Unknown").to_string();
    let mut interfaces: Vec<InterfaceResult> = Vec::new();
    let mut winner_tx: Option<u8> = None;
    let mut winner_firmware: Option<String> = None;
    let mut winner_iface: Option<i32> = None;
    let mut winner_iface_type: Option<String> = None;

    let mut sorted: Vec<_> = all.iter().collect();
    sorted.sort_by_key(|d| if d.usage_page() >= 0xFF00 { 0u8 } else { 1u8 });

    'outer: for info in sorted {
        let iface_type = if info.usage_page() >= 0xFF00 { "vendor" } else { "standard" }.to_string();
        let device = match open_path_str(&api, &info.path().to_string_lossy()) {
            Some(d) => d,
            None => {
                interfaces.push(InterfaceResult {
                    interface: info.interface_number(), usage_page: info.usage_page(),
                    usage: info.usage(), iface_type, results: vec![
                        TxResult { tx_id: 0, ok: false, firmware: None, error: Some("open_failed".into()) }
                    ], access: None,
                });
                continue;
            }
        };

        let mut tx_results = Vec::new();
        for &tx_id in &TX_IDS {
            let r = try_tx(&device, tx_id);
            let stop = r.ok || r.error.as_deref() == Some("no_feature_report_channel");
            let ok = r.ok; let fw = r.firmware.clone();
            tx_results.push(r);
            if ok {
                winner_tx = Some(tx_id); winner_firmware = fw;
                winner_iface = Some(info.interface_number());
                winner_iface_type = Some(iface_type.clone());
                interfaces.push(InterfaceResult {
                    interface: info.interface_number(), usage_page: info.usage_page(),
                    usage: info.usage(), iface_type, results: tx_results, access: None,
                });
                break 'outer;
            }
            if stop { break; }
        }
        interfaces.push(InterfaceResult {
            interface: info.interface_number(), usage_page: info.usage_page(),
            usage: info.usage(), iface_type, results: tx_results, access: None,
        });
    }

    let webid_status = if vid == HYPERPOLLING_VID {
        "native_only"
    } else if winner_iface_type.as_deref() == Some("standard") {
        "workaround"
    } else if winner_iface_type.as_deref() == Some("vendor") {
        "likely"
    } else {
        "unknown"
    }.to_string();

    Ok(DeviceReport {
        vendor_id: vid, product_id: pid, name,
        scan_type: "razer".into(),
        interfaces, winner_tx, winner_firmware, winner_iface, winner_iface_type,
        webid_status,
    })
}

// ── Generic HID scan (non-Razer) ────────────────────────────────────────────
fn run_generic_scan(api: &HidApi, pid: u16, vid: u16) -> Result<DeviceReport, String> {
    let all: Vec<_> = api.device_list()
        .filter(|d| d.vendor_id() == vid && d.product_id() == pid)
        .collect();
    if all.is_empty() {
        return Err(format!("No device found for VID {:04X} PID {:04X}", vid, pid));
    }

    let name = all[0].product_string().unwrap_or("Unknown").to_string();
    let mut interfaces: Vec<InterfaceResult> = Vec::new();
    let mut has_accessible_vendor = false;
    let mut has_blocked_vendor = false;

    let mut sorted: Vec<_> = all.iter().collect();
    sorted.sort_by_key(|d| if d.usage_page() >= 0xFF00 { 0u8 } else { 1u8 });

    for info in sorted {
        let is_vendor = info.usage_page() >= 0xFF00;
        let iface_type = if is_vendor { "vendor" } else { "standard" }.to_string();

        let access = match open_path_str(api, &info.path().to_string_lossy()) {
            None => {
                if is_vendor { has_blocked_vendor = true; }
                IfaceAccessResult { accessible: false, has_feature_report: false, error: Some("open_failed".into()) }
            }
            Some(dev) => {
                if is_vendor { has_accessible_vendor = true; }
                // Try a short feature-report probe (report 0x00)
                let mut buf = vec![0u8; 65];
                let has_fr = dev.get_feature_report(&mut buf).is_ok();
                IfaceAccessResult { accessible: true, has_feature_report: has_fr, error: None }
            }
        };

        interfaces.push(InterfaceResult {
            interface: info.interface_number(),
            usage_page: info.usage_page(),
            usage: info.usage(),
            iface_type,
            results: vec![],
            access: Some(access),
        });
    }

    let webid_status = if has_blocked_vendor && !has_accessible_vendor {
        "native_only"  // vendor interfaces exist but OS won't let us in → Chrome probably can't either
    } else if has_accessible_vendor {
        "likely"       // vendor interface accessible natively
    } else {
        "unknown"      // only standard interfaces, can't predict WebHID
    }.to_string();

    Ok(DeviceReport {
        vendor_id: vid, product_id: pid, name,
        scan_type: "generic".into(),
        interfaces,
        winner_tx: None, winner_firmware: None,
        winner_iface: None, winner_iface_type: None,
        webid_status,
    })
}

#[derive(Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub body: Option<String>,
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            version: Some(update.version.clone()),
            body: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateInfo { available: false, version: None, body: None }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;
    update.download_and_install(|_, _| {}, || {}).await
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![list_devices, run_full_test, check_update, install_update])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

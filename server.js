
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const multer = require('multer');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');
const axios = require('axios');

const app = express();
const DATA_FILE = path.join(__dirname, 'data.json');
const UPLOAD_DIR = path.join(__dirname, 'public/uploads');
const NOTES_DIR = path.join(__dirname, 'secure_notes');

[UPLOAD_DIR, NOTES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'noteFile') cb(null, NOTES_DIR);
        else cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'test_key',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'test_secret'
});

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- PREMIUM EMAIL TEMPLATES ---

const styleHeader = `
    background: linear-gradient(135deg, #0f0c29, #302b63);
    padding: 30px;
    text-align: center;
    border-radius: 10px 10px 0 0;
`;

const styleBody = `
    background-color: #ffffff;
    padding: 40px 30px;
    border: 1px solid #e2e8f0;
    border-top: none;
    border-bottom: none;
    color: #334155;
    font-family: 'Segoe UI', Arial, sans-serif;
`;

const styleFooter = `
    background-color: #f1f5f9;
    padding: 20px;
    text-align: center;
    border-radius: 0 0 10px 10px;
    font-size: 12px;
    color: #64748b;
    border: 1px solid #e2e8f0;
    border-top: none;
`;

// 1. OTP EMAIL
function getOtpTemplate(otp, name) {
    return `
    <div style="max-width: 500px; margin: 20px auto; font-family: sans-serif;">
        <div style="${styleHeader}">
            <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 2px;">LAWVITA</h1>
        </div>
        <div style="${styleBody}">
            <h2 style="color: #1e293b; margin-top: 0; text-align: center;">Login Verification</h2>
            <p style="font-size: 16px;">Hello <strong>${name || 'Student'}</strong>,</p>
            <p style="font-size: 16px; line-height: 1.6;">You requested a login code for your Lawvita account. Use the code below to verify your identity.</p>
            
            <div style="margin: 30px 0; text-align: center;">
                <span style="display: inline-block; background: #f8fafc; border: 2px dashed #db2777; color: #db2777; font-size: 36px; font-weight: bold; letter-spacing: 8px; padding: 15px 30px; border-radius: 8px;">${otp}</span>
            </div>
            
            <p style="font-size: 14px; color: #94a3b8; text-align: center;">This code expires in 10 minutes. If you did not request this, please ignore this email.</p>
        </div>
        <div style="${styleFooter}">
            &copy; ${new Date().getFullYear()} Lawvita Education. All rights reserved.<br>
            Secure Login System
        </div>
    </div>
    `;
}

// 2. INVOICE EMAIL
function getInvoiceTemplate(user, items, total) {
    const itemList = items.map(item => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 12px 0; color: #334155;">${item}</td>
            <td style="padding: 12px 0; color: #334155; text-align: right;">1</td>
        </tr>
    `).join('');

    return `
    <div style="max-width: 600px; margin: 20px auto; font-family: sans-serif;">
        <div style="${styleHeader}">
            <h1 style="color: white; margin: 0; font-size: 24px;">Order Confirmed</h1>
        </div>
        <div style="${styleBody}">
            <p style="font-size: 16px;">Hi <strong>${user.name}</strong>,</p>
            <p style="font-size: 16px;">Thank you for your purchase! Your notes have been added to your dashboard.</p>
            
            <div style="background: #f8fafc; border-radius: 8px; padding: 20px; margin: 25px 0;">
                <h3 style="margin-top: 0; color: #db2777; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">Receipt</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="font-size: 12px; text-transform: uppercase; color: #64748b;">
                            <th style="text-align: left; padding-bottom: 10px;">Item Description</th>
                            <th style="text-align: right; padding-bottom: 10px;">Qty</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemList}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td style="padding-top: 15px; font-weight: bold; color: #1e293b;">Total Paid</td>
                            <td style="padding-top: 15px; font-weight: bold; color: #16a34a; text-align: right; font-size: 18px;">₹${total}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <div style="text-align: center; margin-top: 30px;">
                <a href="http://localhost:3000/dashboard" style="background: #db2777; color: white; text-decoration: none; padding: 12px 30px; border-radius: 25px; font-weight: bold;">Go to Dashboard</a>
            </div>
        </div>
        <div style="${styleFooter}">
            Need help? Contact support@lawvita.com<br>
            Thank you for choosing Lawvita.
        </div>
    </div>
    `;
}

// --- HELPER: LOG TO SHEET ---
async function logToSheet(data) {
    if (!process.env.SHEETDB_URL) return;
    try {
        await axios.post(process.env.SHEETDB_URL, { data: [data] });
    } catch (err) {
        console.error("SheetDB Error:", err.message);
    }
}

// --- HELPER: SEND EMAIL ---
async function sendEmail(to, subject, html) {
    if (!process.env.EMAIL_USER) return;
    try {
        await transporter.sendMail({ to, subject, html });
        console.log(`Email sent to ${to}`);
    } catch (e) {
        console.error("Email Error:", e);
    }
}

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({ secret: 'lawvita_v14', resave: false, saveUninitialized: true }));

const readData = () => {
    if (!fs.existsSync(DATA_FILE)) return { users: [], notes: [], gallery: [], settings: {} };
    return JSON.parse(fs.readFileSync(DATA_FILE));
};
const writeData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

app.use((req, res, next) => {
    const db = readData();
    res.locals.user = req.session.user ? db.users.find(u => u.id === req.session.user.id) : null;
    res.locals.settings = db.settings || { heroType: "image", heroUrl: "#", youtubeUrl: "#" };
    if (req.session.user) req.session.user = res.locals.user;
    next();
});

// --- ROUTES ---
app.get('/', (req, res) => {
    const db = readData();
    res.render('index', { notes: db.notes.slice(-3).reverse(), gallery: db.gallery || [] });
});

app.get('/store', (req, res) => {
    const db = readData();
    let notes = db.notes;
    const search = req.query.search ? req.query.search.toLowerCase() : "";
    const filter = req.query.category;

    if (filter && filter !== 'All') notes = notes.filter(n => n.category === filter);
    if (search) notes = notes.filter(n => n.title.toLowerCase().includes(search));

    const categories = ['All', ...new Set(db.notes.map(n => n.category))];
    res.render('store', { notes, categories, activeFilter: filter || 'All', search });
});

app.get('/cart', (req, res) => {
    if (!res.locals.user) return res.redirect('/login');
    const db = readData();
    const cartIds = res.locals.user.cart || [];
    const cartItems = db.notes.filter(n => cartIds.includes(n.id));
    const total = cartItems.reduce((sum, item) => sum + parseInt(item.price), 0);
    res.render('cart', { cartItems, total, razorpayKey: process.env.RAZORPAY_KEY_ID || 'test_key' });
});

app.get('/cart/remove/:id', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const db = readData();
    const user = db.users.find(u => u.id === req.session.user.id);
    user.cart = user.cart.filter(id => id != req.params.id);
    writeData(db);
    res.redirect('/cart');
});

// ADD TO CART / CLAIM FREE
app.post('/cart/add/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const db = readData();
    const user = db.users.find(u => u.id === req.session.user.id);
    const noteId = parseInt(req.params.id);
    const note = db.notes.find(n => n.id === noteId);

    if (!user.purchasedNotes) user.purchasedNotes = [];
    if (user.purchasedNotes.includes(noteId)) return res.redirect('/dashboard');

    if (parseInt(note.price) === 0) {
        user.purchasedNotes.push(noteId);
        writeData(db);
        
        await logToSheet({
            Date: new Date().toLocaleString(),
            Name: user.name, Email: user.email, Phone: user.phone || "N/A", Address: user.address || "N/A",
            Item: note.title, Category: note.category, Amount: "0 (Free)", Status: "Claimed"
        });
        await sendEmail(user.email, 'Free Note Claimed', getInvoiceTemplate(user, [note.title], 0));
        
        return res.redirect('/dashboard');
    }

    if (!user.cart) user.cart = [];
    if (!user.cart.includes(noteId)) { user.cart.push(noteId); writeData(db); }
    res.redirect('/cart');
});

app.post('/create-order', async (req, res) => {
    const { amount } = req.body;
    try {
        const order = await razorpay.orders.create({ amount: amount * 100, currency: "INR", receipt: "ord_" + Date.now() });
        res.json(order);
    } catch (error) { res.status(500).json({ error: "Payment failed" }); }
});

app.post('/verify-payment', async (req, res) => {
    const db = readData();
    const user = db.users.find(u => u.id === req.session.user.id);
    if (!user.purchasedNotes) user.purchasedNotes = [];
    
    const titles = [];
    const categories = [];
    let total = 0;

    user.cart.forEach(id => { 
        if (!user.purchasedNotes.includes(id)) {
            user.purchasedNotes.push(id);
            const n = db.notes.find(x => x.id === id);
            if(n) { 
                titles.push(n.title); 
                categories.push(n.category);
                total += parseInt(n.price); 
            }
        }
    });
    user.cart = [];
    writeData(db);

    await logToSheet({
        Date: new Date().toLocaleString(),
        Name: user.name, Email: user.email, Phone: user.phone || "N/A", Address: user.address || "N/A",
        Item: titles.join(", "), Category: [...new Set(categories)].join(", "), 
        Amount: total, Status: "Paid"
    });

    await sendEmail(user.email, 'Purchase Successful', getInvoiceTemplate(user, titles, total));

    res.json({ status: "success" });
});

app.get('/dashboard', (req, res) => {
    if (!res.locals.user) return res.redirect('/login');
    if (res.locals.user.isAdmin) return res.redirect('/admin/dashboard');
    const db = readData();
    const myNotes = db.notes.filter(n => (res.locals.user.purchasedNotes || []).includes(n.id));
    res.render('dashboard', { myNotes });
});

app.get('/read/:id', (req, res) => {
    if (!res.locals.user) return res.redirect('/login');
    const db = readData();
    if (!res.locals.user.purchasedNotes.includes(parseInt(req.params.id))) return res.send("Access Denied");
    const note = db.notes.find(n => n.id == req.params.id);
    res.render('viewer', { note, user: res.locals.user });
});

app.get('/stream-pdf/:filename', (req, res) => {
    if (!req.session.user) return res.status(403).send("Forbidden");
    const filePath = path.join(NOTES_DIR, req.params.filename);
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/pdf');
        fs.createReadStream(filePath).pipe(res);
    } else res.status(404).send("File not found");
});

app.get('/admin-login', (req, res) => res.render('admin-login', { msg: '' }));
app.post('/admin-login-action', (req, res) => {
    const db = readData();
    const admin = db.users.find(u => u.email === req.body.email && u.isAdmin);
    if (admin && admin.password === req.body.password) { req.session.user = admin; res.redirect('/admin/dashboard'); }
    else res.render('admin-login', { msg: 'Invalid' });
});

app.get('/admin/dashboard', (req, res) => {
    if (!res.locals.user || !res.locals.user.isAdmin) return res.redirect('/admin-login');
    const db = readData();
    res.render('admin-dashboard', { allUsers: db.users, allNotes: db.notes, gallery: db.gallery || [] });
});

app.post('/admin/add-note', upload.single('noteFile'), (req, res) => {
    const db = readData();
    let fileUrl = '#'; let type = 'link'; let filename = '';
    if (req.file) { filename = req.file.filename; type = 'file'; } 
    else if (req.body.fileLink) { fileUrl = req.body.fileLink; }
    db.notes.push({ id: Date.now(), title: req.body.title, category: req.body.category, price: req.body.price, fileType: type, fileLink: fileUrl, fileName: filename });
    writeData(db);
    res.redirect('/admin/dashboard');
});

app.get('/admin/delete-note/:id', (req, res) => {
    const db = readData();
    db.notes = db.notes.filter(n => n.id != req.params.id);
    writeData(db);
    res.redirect('/admin/dashboard');
});

app.post('/admin/add-gallery', upload.single('galleryImage'), (req, res) => {
    const db = readData();
    if (req.file) { if (!db.gallery) db.gallery = []; db.gallery.push({ id: Date.now(), url: `/uploads/${req.file.filename}` }); writeData(db); }
    res.redirect('/admin/dashboard');
});

app.get('/admin/delete-gallery/:id', (req, res) => {
    const db = readData();
    db.gallery = db.gallery.filter(g => g.id != req.params.id);
    writeData(db);
    res.redirect('/admin/dashboard');
});

app.post('/admin/update-hero', upload.single('heroFile'), (req, res) => {
    const db = readData();
    if (req.file) { db.settings.heroUrl = `/uploads/${req.file.filename}`; db.settings.heroType = req.file.mimetype.startsWith('video') ? 'video' : 'image'; }
    if (req.body.youtubeUrl) db.settings.youtubeUrl = req.body.youtubeUrl;
    writeData(db);
    res.redirect('/admin/dashboard');
});

app.get('/admin/toggle-ban/:id', (req, res) => {
    const db = readData();
    const user = db.users.find(u => u.id === req.params.id);
    if (user && !user.isAdmin) { user.isBanned = !user.isBanned; writeData(db); }
    res.redirect('/admin/dashboard');
});

app.get('/admin/delete-user/:id', (req, res) => {
    const db = readData();
    db.users = db.users.filter(u => u.id != req.params.id);
    writeData(db);
    res.redirect('/admin/dashboard');
});

app.post('/admin/change-password', (req, res) => {
    const db = readData();
    const admin = db.users.find(u => u.id === req.session.user.id);
    if(admin) { admin.password = req.body.newPassword; writeData(db); }
    res.redirect('/admin/dashboard');
});

app.get('/login', (req, res) => res.render('login', { msg: '' }));
app.get('/register', (req, res) => res.render('register', { msg: '' }));

app.post('/student-auth', async (req, res) => {
    const { email, name, phone, address, type } = req.body;
    const db = readData();
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    let userIndex = db.users.findIndex(u => u.email === email);
    let displayName = name;
    
    if (type === 'login') {
        if (userIndex === -1) return res.render('login', { msg: 'Account not found. Please Register.' });
        if (db.users[userIndex].isBanned) return res.render('login', { msg: 'Banned.' });
        db.users[userIndex].otp = otp;
        displayName = db.users[userIndex].name;
    }
    if (type === 'register') {
        if (userIndex !== -1) return res.render('register', { msg: 'Email exists.' });
        db.users.push({ id: Date.now().toString(), email, name, phone, address, isAdmin: false, isBanned: false, cart: [], purchasedNotes: [], otp });
    }
    writeData(db);
    await sendEmail(email, '🔐 Lawvita Login Code', getOtpTemplate(otp, displayName));
    res.render('verify-otp', { email });
});

app.post('/verify-otp', (req, res) => {
    const db = readData();
    const user = db.users.find(u => u.email === req.body.email && u.otp === req.body.otp);
    if (user) { user.otp = null; writeData(db); req.session.user = user; res.redirect('/dashboard'); }
    else res.render('login', { msg: 'Invalid OTP' });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });
app.listen(3000, () => console.log('Server running on http://localhost:3000'));

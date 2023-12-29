require('dotenv').config();
const express = require('express');
const http = require('http');
const cookie = require('cookie-parser');
const socketIO = require('socket.io');
const chokidar = require('chokidar');
const fs = require('fs');
const mysql = require('mysql');
const md5 = require('js-md5');
const sessions = require('express-session');

var path = __dirname.split('\\')
path.pop()
var home = path.join('\\');

const port = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const oneDay = 1000 * 60 * 60 * 24;
const filePath = "rfid-id.txt";
const watcher = chokidar.watch(filePath);   // watcherrrr to monitor rfid-id.txt
var cart_session;

app.use(express.static(__dirname));
app.use(express.json());
app.use(cookie());
app.use(express.urlencoded({ extended: true }));
app.use(sessions({
    secret: SECRET,
    saveUninitialized: true,
    cookie: { maxAge: oneDay },
    resave: false
}));

const stripe = require("stripe")(STRIPE_KEY)

app.post("/create-checkout-session", async (req, res) => {

    try {
    const staticShippingAddress = {
        line1: '123 Main Street',
        city: 'City',
        postal_code: '12345',
        state: 'State',
        country: 'IN',
    };

    const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: req.body.items.map(item => {
            return {
                price_data: {
                    currency: "inr",
                    product_data: {
                        name: item.name,
                    },
                    unit_amount: item.price*100,
                },
                quantity: item.quantity,
            }
        }),
        customer_email: req.body.customer_email, 
        success_url: `http://localhost:3000/success`,
        cancel_url: `http://localhost:3000/goback`,
    })
        
    cart_session = req.body.items
    console.log(cart_session)
    res.json({ url: session.url })
    } catch (e) {
        res.status(500).json({ error: e.message })
    }
})

// create connection object
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'wt',
});

// establish connection
connection.connect((err) => {
    if (err) {
        console.error('Error connecting to MySQL:', err);
        return;
    }
    console.log('Connected to MySQL');
});

// initial login page
app.get('/', (req, res) => {
    res.sendFile(home + "\\frontend\\login.html");
});

// upon success of transaction
app.get('/success', (req, res) => {
    res.cookie("username", "", { maxAge: "1800000" })
    res.cookie("contact", "", { maxAge: "1800000" })
    res.cookie("validity", "true", { maxAge: '1800000' })
    res.sendFile(home + "\\frontend\\success.html");
});

// in case of new user
app.get('/register', (req, res) => {
    res.cookie("validity", "true", { maxAge: "1800000" });
    res.sendFile(home + "\\frontend\\register.html");
});

// to send stylesheets to the browser
app.get('/style', (req, res) => {
    var q = req.query.page;
    res.sendFile(home + q);
});

// handle new user registration
app.post('/new-user', (req, res) => {
    var user = req.body;
    var pw = user.pw;
    var con = user.confirm;

    if (pw===con) {
        var query = "INSERT INTO users(email, username, password, contact) VALUES (?, ?, ?, ?)";
        connection.query(query, [user.email, user.username, md5(pw), user.contact], (err, results) => {
            if (err) {
                // redirect to register page
                res.cookie("validity", "false", { maxAge: '1800000' });
                res.sendFile(home + "\\frontend\\register.html");
                console.error('Error executing query:', err);
                // return;
            }
            else {
                res.cookie("validity", "true", { maxAge: '1800000' });
                res.cookie('username', user.username, { maxAge: '1800000' });
                res.cookie('contact', user.contact, { maxAge: '1800000' });                
                res.sendFile(home + "\\frontend\\cart.html");
            }
        }); 
        // console.log(true);
        
    }
    else {
        // redirect to register page
        console.log("pw not equal")
        res.cookie("validity", "false", { maxAge: '1800000' });
        res.sendFile(home + "\\frontend\\register.html");
    }
});

// check user login
app.post('/home', (req, res) => {
    var user = req.body;
    var query = "SELECT * FROM users WHERE email=?";

    try {
        connection.query(query, [user.email], (err, results) => {
            console.log(results);
            if (err) {
                // redirect to login page
                res.cookie("validity", "false", { maxAge: '1800000' });
                res.redirect("/");
                console.error('Error executing query:', err);
                return;
            }
            else {
                if (md5(user.pw) !== results[0].password) {
                    // redirect to login page if wrong password
                    res.cookie("validity", "false", { maxAge: '1800000' });
                    res.sendFile(home + "\\frontend\\login.html");
                }
                else {
                    res.cookie("validity", "true", { maxAge: '1800000' });
                    res.cookie('username', results[0].username, { maxAge: '1800000' });
                    res.cookie('contact', results[0].contact, { maxAge: '1800000' });
                    res.sendFile(home + "\\frontend\\cart.html");
                }
            }
        });         
        
    } catch (error) {
        res.cookie("validity", "false", { maxAge: '1800000' });
        res.sendFile(home + "\\frontend\\login.html");        
        
    }
});

// server initiation
server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
   
});



watcher.on('change', () => {
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    const content2 = content.split("\n");
    // Query the MySQL table using the RFID ID
    const query = 'SELECT * FROM products WHERE product_id = ?';

    connection.query(query, [content2[content2.length - 1]], (err, results) => {
        if (err) {
            console.error('Error executing query:', err);
            // return;
        }
        
        io.emit('file-update', results);
    });
});

// in case of failed transaction
app.get("/goback", (req, res) => {
    res.cookie("username", "", { maxAge: '1800000' })
    res.cookie("contact", "", { maxAge: '1800000' })
    res.cookie("validity", "true", { maxAge: '1800000' })
    res.redirect("/")
})

// close mysql connection
process.on('SIGINT', () => {
    connection.end((err) => {
        if (err) {
            console.error('Error closing MySQL connection:', err);
        }
        console.log('MySQL connection closed');
        process.exit();
    });
});

/*
test@gmail.com
4000003560000008

*/
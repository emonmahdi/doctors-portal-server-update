const express = require("express");
const app = express();
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const nodemailer = require('nodemailer');
const sgTransport = require('nodemailer-sendgrid-transport');
const port = process.env.PORT || 5000;

//middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.otxcso3.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized person" });
  }
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: "Forbidden Access" });
    }
    req.decoded = decoded;
    next();
  });
};

const emailSenderOptions = {
  auth: {
      api_key: process.env.EMAIL_SENDER_KEY
  }
}

const  mailer = nodemailer.createTransport(sgTransport(emailSenderOptions));

// sender grid mail
function sendAppointmentEmail(booking){
  const {patient, patientName, treatment, date, slot} = booking;

  const email = {
    to: patient,
    from: process.env.EMAIL_SENDER,
    subject: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    text: `Your Appointment for ${treatment} is on ${date} at ${slot} is confirmed`,
    html: `
    <div>
      <h3>Hello ${patientName}</h3>
      <p>Your Appointment for ${treatment} is confirmed</p>
      <p>Looking forward to seeing you on ${date} at ${slot}</p>

      <h4>Our Address:</h4>
      <p>Barishal Rupatali</p>
      <p>Bangladesh</p>
      <a href="https://web.programming-hero.com/">unsubscribed</a>
    </div>
    `,
};

  mailer.sendMail(email, function(err, res) {
    if (err) { 
        console.log(err) 
    }
    console.log(res);
  });
  } 

async function run() {
  try {
    await client.connect();
    const servicesCollection = client
      .db("doctors_portal")
      .collection("services");
    const bookingCollection = client
      .db("doctors_portal")
      .collection("bookings");
    const userCollection = client.db("doctors_portal").collection("users");
    const doctorCollection = client.db("doctors_portal").collection("doctors");

    // verifyAdmin
    const verifyAdmin = async(req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({
        email: requester,
      });
      if (requesterAccount.role === "admin") {
        next();
      }else{
        res.status(403).send({message: 'forbidden'})
      }
    }

    // GET API
    app.get("/service", async (req, res) => {
      const query = {};
      const cursor = servicesCollection.find(query).project({name: 1});
      const result = await cursor.toArray();
      res.send(result);
    });
    // All users get api
    app.get("/user", verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    // check admin or not API
    app.get('/admin/:email', async(req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({email: email});
      const isAdmin = user.role === 'admin';
      res.send({admin: isAdmin});
    })

    // PUT API USER admin
    app.put("/user/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;  
        const filter = { email: email };
        const updateDoc = {
          $set: { role: "admin" },
        };
        const result = await userCollection.updateOne(filter, updateDoc);
        res.send(result); 
    });
    // PUT API USER
    app.put("/user/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign(
        { email: email },
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "1h" }
      );
      res.send({ result, token });
    });

    // Warning:
    // This is not the proper way

    app.get("/available", async (req, res) => {
      const date = req?.query?.date || "Dec 4, 2022";

      // step: 1: get all services data
      const services = await servicesCollection.find().toArray();

      // step -2: get the booking of that day
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();

      //step:3 - for each service,
      services.forEach((service) => {
        // step 4: find booking for that service
        const serviceBookings = bookings.filter(
          (book) => book.treatment === service.name
        );

        // step 5: select slot for service booking
        const bookedSlots = serviceBookings.map((book) => book.slot);

        // step 6: select slot that are not in bookSlots
        const available = service.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        // step 7: set available to slots to make it easier
        service.slots = available;
      });

      res.send(services);
    });

    // POST API Booking
    app.post("/booking", async (req, res) => {
      const booking = req.body;
      const query = {
        treatment: booking.treatment,
        date: booking.date,
        patient: booking.patient,
      };
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists });
      }
      const result = await bookingCollection.insertOne(booking);

      console.log('Sender Email');
      sendAppointmentEmail(booking)
      
      return res.send({ success: true, result });
    });
    //GET API booking patient
    app.get("/booking", verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const result = await bookingCollection.find(query).toArray();
        res.send(result);
      } else {
        return res.status(403).send({ message: "forbidden access" });
      }
    });

    // Doctor GET API
    app.get('/doctor', verifyJWT, verifyAdmin, async(req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    })

    // Doctor POST API
    app.post('/doctor', verifyJWT, verifyAdmin, async(req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result)
    })
    // Doctor DELETE API
    app.delete('/doctor/:email', verifyJWT, verifyAdmin, async(req, res) => {
      const email = req.params.email;
      const filter = {email: email};
      const result = await doctorCollection.deleteOne(filter);
      res.send(result)
    })

    /* 
          // API naming convention
          1. app.get('/booking')-- all booking get data
          2. app.get('/booking/:id')-- specific data get
          3. app.post('/booking')-- post the one data
          4. app.patch('/booking/:id')-- update specific id data
          5. app.delete('/booking/:id')-- delete the specific id data
          */
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello Doctors portal");
});

app.listen(port, () => {
  console.log(`Running Doctors Portal server ${port}`);
});

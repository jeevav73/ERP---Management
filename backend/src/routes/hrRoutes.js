import express from 'express';
const router = express.Router();
import Employee from "../models/Hr&Staff.js";

const normalizeMobile = (value = '') => {
  const digits = String(value).replace(/\D/g, '');
  return digits.replace(/^91/, '');
};

const normalizeAadhaar = (value = '') => {
  return String(value).replace(/\D/g, '');
};

const regexDigits = (digits) => {
  return digits.split('').join('\\D*');
};

const buildEmployeePayload = (employeeData = {}) => {
  const employeePayload = {
    ...employeeData,
    recruiterHrId: employeeData.recruiterHrId || employeeData.hrId || employeeData.selectedHrId || "",
    recruiterHrName: employeeData.recruiterHrName || employeeData.hrName || employeeData.selectedHrName || "",
  };

  delete employeePayload.recruiterHrContact;
  delete employeePayload.recruiterHrDomain;
  delete employeePayload.recruiterHrDetails;

  return employeePayload;
};

const validateEmployeeFields = (employeeData = {}) => {
  const requiredFields = [
    "name",
    "mobile",
    "dept",
    "service",
    "role",
    "doj",
    "address",
  ];

  const missing = requiredFields.filter((field) => {
    const value = employeeData[field];
    return value === undefined || value === null || String(value).trim() === "";
  });

  return missing;
};

const createSingleEmployee = async (employeeData) => {
  const employeePayload = buildEmployeePayload(employeeData);
  const rawMobile = employeeData.mobile || '';
  const rawAadhaar = employeeData.aadhaar || '';
  const mobile = normalizeMobile(rawMobile);
  const aadhaar = normalizeAadhaar(rawAadhaar);
  const { dept } = employeeData;

  const duplicateQueries = [];
  if (mobile) {
    const mobileRegex = new RegExp(`^\\D*${regexDigits(mobile)}\\D*$`);
    duplicateQueries.push(
      { mobile: rawMobile },
      { mobile: `+91${mobile}` },
      { mobile: `91${mobile}` },
      { mobile: mobile },
      { mobile: { $regex: mobileRegex } }
    );
  }
  if (aadhaar) {
    const aadhaarRegex = new RegExp(`^\\D*${regexDigits(aadhaar)}\\D*$`);
    duplicateQueries.push(
      { aadhaar: rawAadhaar },
      { aadhaar: aadhaar },
      { aadhaar: { $regex: aadhaarRegex } }
    );
  }

  const existingEmployee = duplicateQueries.length > 0
    ? await Employee.findOne({ $or: duplicateQueries })
    : null;

  if (existingEmployee) {
    throw new Error("Employee already exists with this Mobile or Aadhaar number!");
  }

  const deptPrefixes = {
    homecare: "HC",
    healthcare: "HCC",
    calls: "CL",
    it: "IT",
    nonit: "NIT",
    labour: "LB"
  };
  const pfx = deptPrefixes[dept] || "EMP";

  let generatedIdBase = null;
  if (mobile) {
    const last4 = mobile.slice(-4);
    generatedIdBase = `EMP-${pfx}-M${last4}`;
  } else if (aadhaar) {
    const last4 = aadhaar.slice(-4);
    generatedIdBase = `EMP-${pfx}-A${last4}`;
  } else {
    const count = await Employee.countDocuments({ dept });
    const nextNumber = 100 + count + 1;
    generatedIdBase = `EMP-${pfx}-${nextNumber}`;
  }

  let candidateId = generatedIdBase;
  let suffix = 1;
  while (await Employee.findOne({ id: candidateId })) {
    candidateId = `${generatedIdBase}-${suffix}`;
    suffix += 1;
  }

  const newEmployee = new Employee({
    ...employeePayload,
    id: candidateId,
    status: "Present"
  });

  return await newEmployee.save();
};

// @route   POST /api/employees
// @desc    Add new employee with Duplicate Check & Auto-ID
router.post('/', async (req, res) => {
  try {
    const missingFields = validateEmployeeFields(req.body);
    if (missingFields.length > 0) {
      return res.status(400).json({
        message: "Employee validation failed",
        missingFields,
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    const savedEmployee = await createSingleEmployee(req.body);
    res.status(201).json(savedEmployee);
  } catch (err) {
    const message = err.message || "Error saving employee";
    res.status(400).json({ message, error: message });
  }
});

// @route   POST /api/hr/bulk
// @desc    Add multiple employees in one request
router.post('/bulk', async (req, res) => {
  try {
    const employeeList = Array.isArray(req.body) ? req.body : [req.body];

    if (employeeList.length === 0) {
      return res.status(400).json({ message: "Bulk employee list is empty" });
    }

    const savedEmployees = [];
    const errors = [];

    for (let index = 0; index < employeeList.length; index += 1) {
      const employee = employeeList[index];
      const missingFields = validateEmployeeFields(employee);

      if (missingFields.length > 0) {
        errors.push({
          index,
          message: `Missing required fields: ${missingFields.join(', ')}`,
          employee,
        });
        continue;
      }

      try {
        const savedEmployee = await createSingleEmployee(employee);
        savedEmployees.push(savedEmployee);
      } catch (err) {
        errors.push({
          index,
          message: err.message || "Error saving employee",
          employee,
        });
      }
    }

    if (savedEmployees.length === 0) {
      return res.status(400).json({
        message: "No employees were saved",
        errors,
      });
    }

    return res.status(201).json({
      message: `Bulk employee import completed: ${savedEmployees.length} saved`,
      savedEmployees,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    return res.status(500).json({
      message: "Error saving bulk employees",
      error: err.message,
    });
  }
});

// @route   GET /api/employees
router.get('/', async (req, res) => {
  try {
    // console.log("📡 GET /api/hr - Fetching employees...");
    
    // First, check total employees in DB
    const totalCount = await Employee.countDocuments({});
    // console.log("📊 Total employees in DB:", totalCount);
    
    // Fetch employees that are either: not marked inactive OR don't have isActive field (backward compatibility)
    const employees = await Employee.find({ 
      $or: [
        { isActive: true },
        { isActive: { $exists: false } }
      ]
    }).sort({ createdAt: -1 });
    
    // console.log("✅ Active employees found:", employees.length);
    // console.log("📋 Employee IDs:", employees.map(e => e.id).join(", "));
    
    res.json(employees);
  } catch (err) {
    console.error("❌ Error fetching employees:", err.message);
    res.status(500).json({ message: "Error fetching employees", error: err.message });
  }
});

// @route   GET /api/employees/ex-employees
// @desc    Get all deactivated (ex) employees
router.get('/ex-employees/list', async (req, res) => {
  try {
    const exEmployees = await Employee.find({ isActive: false }).sort({ deactivatedAt: -1 });
    res.json(exEmployees);
  } catch (err) {
    res.status(500).json({ message: "Error fetching ex-employees", error: err.message });
  }
});

// @route   PUT /api/employees/:id
// @desc    Update employee details
router.put('/:id', async (req, res) => {
  try {
    const updatedEmployee = await Employee.findOneAndUpdate(
      { id: req.params.id },
      req.body,
      { new: true }
    );
    if (!updatedEmployee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    res.json(updatedEmployee);
  } catch (err) {
    res.status(400).json({ message: "Error updating employee", error: err.message });
  }
});

// @route   PATCH /api/employees/:id/deactivate
// @desc    Soft delete - mark employee as inactive (moved to ex-employees)
router.patch('/:id/deactivate', async (req, res) => {
  try {
    const updatedEmployee = await Employee.findOneAndUpdate(
      { id: req.params.id },
      { 
        isActive: false,
        deactivatedAt: new Date()
      },
      { new: true }
    );
    if (!updatedEmployee) {
      return res.status(404).json({ message: "Employee not found" });
    }
    res.json({ message: "Employee moved to ex-employees", employee: updatedEmployee });
  } catch (err) {
    res.status(400).json({ message: "Error deactivating employee", error: err.message });
  }
});

// PATCH /recruiters/:id/status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    await RecruiterForm.findByIdAndUpdate(req.params.id, { status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

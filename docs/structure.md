src/
├── common/ # Các logic chung, dùng lại nhiều nơi
│ ├── decorators/ # Custom decorators (e.g. @User(), @Auth())
│ ├── filters/ # Exception filters
│ ├── guards/ # Auth guards (JWT, Roles...)
│ ├── interceptors/ # Logging, Transform, Timeout...
│ ├── pipes/ # Validation pipes
│ └── utils/ # Helper functions
│
├── config/ # Config cho ứng dụng
│ ├── database.config.ts # Config DB (Mongo, SQL…)
│ ├── mongodb.ts # MongoDB provider
│ ├── redis.ts # Redis provider
│ └── app.config.ts # Các biến cấu hình khác
│
├── modules/ # Mỗi module = 1 feature
│ ├── auth/ # Module xác thực
│ │ ├── auth.controller.ts
│ │ ├── auth.service.ts
│ │ ├── auth.module.ts
│ │ └── strategies/ # JWT, Local, Google, ...
│ │
│ ├── users/ # Module quản lý user
│ │ ├── users.controller.ts
│ │ ├── users.service.ts
│ │ ├── users.module.ts
│ │ ├── schemas/ # Mongo schemas (User.schema.ts)
│ │ └── dto/ # DTOs cho validate
│ │
│ └── products/ # Ví dụ module sản phẩm
│ ├── products.controller.ts
│ ├── products.service.ts
│ ├── products.module.ts
│ ├── schemas/
│ └── dto/
│
├── app.module.ts # Module gốc
├── main.ts # Entry point
│
└── shared/ # Các module / service tái sử dụng
├── mail/ # Email service
├── cache/ # Cache service (Redis)
└── logger/ # Logging service

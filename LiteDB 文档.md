# LiteDB 文档

未完成，持续更新中

## 简介

对MyDB项目的复刻实现。

原作者项目地址：https://github.com/CN-GuoZiyang/MYDB

原作者项目文档：https://shinya.click/projects/mydb/mydb0

本数据库项目实现了以下功能：

- 数据的可靠性和数据恢复
- 两段锁协议（2PL）实现可串行化调度
- MVCC
- 两种事务隔离级别（读提交和可重复读）
- 死锁处理
- 简单的表和字段管理
- 简陋的 SQL 解析
- 基于 socket 的 server 和 client



## 整体结构

LiteDB项目分为前端和后端，前后段通过socket交互。前端读取用户输入发送到后端执行，输出返回结果并等待下一次输入。后端会解析SQL语句，如果是合法的SQL语句，则执行返回结果。后端部分分为五个模块：

1. Transaction Manager (TM)
2. Data Manager (DM)
3. Version Manager (VM)
4. Index Manager (IM)
5. Table Manager (TBM)

各部分职责：

1. TM负责通过XID（每个事务都有一个XID）来维护事务状态，并提供接口供其他模块检查某个事务状态。

2. DM管理数据库DB文件和日志文件。DM主要职责：1）分页管理DB文件并缓存；2）管理日志文件，发生错误时可以根据日志恢复；3）将DB文件抽象为DataItem供上层模块使用并提供缓存。
3. VM
4. IM
5. TBM





## Tansaction Manager (TM)

TM负责通过XID（每个事务都有一个XID）来维护事务状态，并提供接口供其他模块检查某个事务状态。

### 结构

TM主要负责管理事务的生命周期，包括：

* 事务创建 begin()
* 事务提交 commit()
* 事务回滚 abort()
* 事务状态查询：isActive() / isCommitted() / isAborted()

其通过XID文件持久化事务状态，利用文件锁（ReetrantLock）确保xidCounter在并发环境下安全更新。



### XID文件（.xid）

每一个事务都有一个XID，其唯一标识了这个事务。事务XID从1开始自增，且不可重复。XID 0是一个超级事务，XID为0的事务状态永远是committed。

* 前8字节：存储xidCounter（当前最大事务ID/当前事务个数）

* 事务XID在文件中的状态存储于 '(xid - 1) + 8' 字节处，xid - 1因为XID 0的状态不需要记录。

* 每个事务占1字节，其value代表了事务状态：
  ``` Java
  private static final byte FIELD_TRAN_ACTIVE = 0;		//活跃
  private static final byte FIELD_TRAN_COMMITTED = 1;	//已提交
  private static final byte FIELD_TRAN_ABORTED = 2;		//已回滚
  ```

Transaction Manager提供了一些接口用于创建事务和查询事务状态。

```Java
public interface TransactionManager {
    long begin();
    void commit(long xid);
    void abort(long xid);
    boolean isActive(long xid);
    boolean isCommitted(long xid);
    boolean isAborted(long xid);
    void close();												//关闭TM
  	...
}
```

其中还有两个静态方法：

* create() ：创建一个xid文件并创建TM。从零创建xid文件时需要写一个空的xid文件头，即xidCounter设置为0。
* open() ：从一个已有的xid文件来创建TM。



### 文件读写

文件的读写采用了NIO方式的FileChannel。

FileChannel: 用于文件I/O的通道，支持文件的读写和追加操作。允许在文件的任意位置进行数据传输，支持文件锁定以及内存映射等高级功能。FileChannel 无法设置为非阻塞模式，因此它只适用于阻塞式文件操作。

Channel通道只负责传输数据，不直接操作数据。操作数据是通过ByteBuffer。



### XID校验

构造函数创建了一个TM后，首先要对XID文件进行校验。其通过文件头的8字节反推文件的理论长度，于实际长度做对比。如果不同则XID文件不合法。

```Java
private void checkXIDCounter() {
    long fileLen = 0;
    try {
        fileLen = file.length();
    } catch (IOException e1){
        Panic.panic(Error.BadXIDFileException);
    }

    if (fileLen < LEN_XID_HEADER_LENGTH) {
        Panic.panic(Error.BadXIDFileException);
    }

    ByteBuffer buffer = ByteBuffer.allocate(LEN_XID_HEADER_LENGTH);
    try {
        fileChannel.position(0);
        fileChannel.read(buffer);
    } catch (IOException e) {
        Panic.panic(e);
    }
    this.xidCounter = Parser.parseLong(buffer.array());
    long end = getXidPosition(this.xidCounter + 1);
    if (end != fileLen) {
        Panic.panic(Error.BadXIDFileException);
    }
}
```



### 开启事务 (begin())

begin() 方法会开始一个事务。其首先设置 xidCounter+1 事务（新事务）的状态为active，随后xidCounter自增，更新文件头。

```Java
public long begin() {
      counterLock.lock();
      try {
          // 新XID
          long xid = xidCounter + 1;
          // 更新新建XID状态为active
          updateXID(xid, FIELD_TRAN_ACTIVE);
          // 讲XID加一，并更新XID Header
          incrXIDCounter();
          return xid;
      } finally {
          counterLock.unlock();
      }
  }

  // 用于更新xid事务状态为status
  private void updateXID(long xid, byte status) {
      long offset = getXidPosition(xid);
      byte[] tmp = new byte[XID_FIELD_SIZE];
      tmp[0] = status;
      ByteBuffer buffer = ByteBuffer.wrap(tmp);
      try {
          // 在offset位置开始写入新的xid事务status
          fileChannel.position(offset);
          fileChannel.write(buffer);
      } catch (IOException e) {
          Panic.panic(e);
      }
      try {
          // 强制写入磁盘
          fileChannel.force(false);
      } catch (IOException e) {
          Panic.panic(e);
      }
  }

  // 将XID加一，并更新XID Header
  private void incrXIDCounter() {
      xidCounter++;
      // 将xidCounter整合为byte类型存入buffer
      ByteBuffer buffer = ByteBuffer.wrap(Parser.long2Byte(xidCounter));
      try {
          // 从开头开始更新XID Header
          fileChannel.position(0);
          fileChannel.write(buffer);
      } catch (IOException e) {
          Panic.panic(e);
      }
      try {
          fileChannel.force(false);
      } catch (IOException e) {
          Panic.panic(e);
      }
  }
```



### 提交与回滚事务 (commit() & abort())

提交和回滚就借助updateXID来更新其status。

```Java
// 将xid事务状态设置为committed
public void commit(long xid) {
    updateXID(xid, FIELD_TRAN_COMMITTED);
}

// 将xid事务状态设置为aborted
public void abort(long xid) {
    updateXID(xid, FIELD_TRAN_ABORTED);
}
```



### 检查XID状态

通过一个chekXID方法来检查status。

```Java
private boolean checkXID(long xid, byte status) {
    long offset = getXidPosition(xid);
    ByteBuffer buffer = ByteBuffer.wrap(new byte[XID_FIELD_SIZE]);
    try {
        fileChannel.position(offset);
        fileChannel.read(buffer);
    } catch (IOException e) {
        Panic.panic(e);
    }
    return buffer.array()[0] == status;
}
```

其他的isActive(), isCommitted(), isAborted()则通过此方法来实现。

```Java
public boolean isActive(long xid) {
    if (xid == SUPER_XID) {
        return false;
    }
    return checkXID(xid, FIELD_TRAN_ACTIVE);
}

public boolean isCommitted(long xid) {
    if (xid == SUPER_XID) {
        return true;
    }
    return checkXID(xid, FIELD_TRAN_COMMITTED);
}

public boolean isAborted(long xid) {
    if (xid == SUPER_XID) {
        return false;
    }
    return checkXID(xid, FIELD_TRAN_ABORTED);
}
```






//  leadsolver.cpp
//
//  Matthew J. Kidd (San Diego, CA)
//
//  Calculates number of double dummy tricks taken for each possible card
//  led from one seat in a specified denomination. It is mostly a wrapper 
//  for Bo Haglund's Double Dummy Solver (dds.dll) but it does some tallying
//  of the results to compute the average number of tricks (for matchpoints)
//  and chance of setting the contract (for team play) for each lead.
//
//  To compile the code using the Microsoft C compiler from the Visual Studio
//  Command Prompt on a 32-bit Windows computer
//
//    cl /EHsc leadsolver.cpp
//
//  You don't need to compile this code with optimization (e.g. /O2). All
//  the CPU intensive work is done in Bo Haglund's dds.dll, which is compiled
//  with optimization on.
//
//  If you are compiling on a 64-bit Windows platform, you need to make sure
//  you create a 32-bit executable (target) instead of a 64-bit executable
//  because a 64-bit one will not be able to use the 32-bit dds.dll. You
//  might think this would be done with a compiler switch, but you would be
//  wrong. If you have MSVC installed on a 64-bit platform, you will have
//  several versions of the compile/linker program (cl). See this web page:
//  http://msdn.microsoft.com/en-us/library/x4d2c09s.aspx. You should be okay
//  if you run cl from the "Visual Studio Command Prompt". Do not choose the
//  "Visual Studio x64 Win64 Command Prompt" or the "Visual Studio x64 Cross
//  Tools Command Prompt".
//
//  To compile the code for Mac OS X with gcc, use:
//
//    g++-4.9 -o ddsolver -O2 -Wall leadsolver.cpp dds.a -lgomp
//
//  A specific version of gcc (4.9) is referenced here (installed via Homebrew,
//  see http://brew.sh/) though other recent versions should work. The issue is
//  that DDS 2.1 (2010-05-29) and later use OpenMP for parallelization on
//  non-Windows platforms. GCC supports OpenMP but the Apple XCode clang (LLVM)
//  compiler doesn't. But out of the box, XCode 4.2 and later symlinks gcc/g++
//  to clang. Specifying g++-#.# ensures you are really using GCC.
//
//  Here dds.a is a library created from all the C++ files as follows for DDS 2.7.0
//
//    g++-4.9 -c -W -O2 -fopenmp foo.cpp  (for each C++ file)
//    ar rc dds.a *.o  (create an archive)
//    ranlib dds.a  (index it to make a static library)
//
//  Note: DDS 2.8.0 includes platform specific makefiles.
//
//  This code works but Windows C++ development isn't my strength. This code
//  shouldn't be considered a model reference.
//
//  28-Nov-2013 - Original code by Matthew Kidd
//  26-Nov-2014 - Last revision

double getRealTime();

// Not necessary, but might speed up compilation.
#if defined(_MSC_VER)
#define WIN32_LEAN_AND_MEAN
#endif

#define VER_STR "1.0.2"
#define NLEADS 64
#define MAX_BATCH_DEALS 50

#define SUCCESS                 0
#define ERR_DDS_LOAD_FAILED     1
#define ERR_NO_SolveAllBoards   2
#define ERR_BAD_INPUT_FILE      3
#define ERR_BAD_OUTPUT_FILE     4
#define ERR_ARG_PARSING         5

#if defined(_WIN32)
#include <Windows.h>

#elif defined(__unix__) || defined(__unix) || defined(unix) || (defined(__APPLE__) && defined(__MACH__))
#include <unistd.h>	   // POSIX flags
#include <time.h>	     // clock_gettime(), time()
#include <sys/time.h>	 // gethrtime(), gettimeofday()

#if defined(__MACH__) && defined(__APPLE__)
#include <mach/mach.h>
#include <mach/mach_time.h>
#endif

#else
#error "Unable to define getRealTime() for an unknown OS."
#endif

#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <iostream>
#include <fstream>
#include <sstream>
#include <ctime>

#include "dll.h"

using namespace std;

typedef struct {
  int ix;
  int nTricks[14];
  float avgTricks;
  float setPct;
} leadcard;

// For sorting the tally
int leadComp(const void *a, const void *b) {
  float v = (*((leadcard**) b))->avgTricks - (*((leadcard**) a))->avgTricks;
  return (v < 0 ? -1 : v==0 ? 0 : 1);
}

int main(int argc, char* argv[]) {
	char *contract = NULL;
  char *infname = NULL;
  char *outfname = NULL;

#if defined(_WIN32)
  HRESULT hResult;
  LPVOID lpMsgBuf;
#endif
  
  int rs;
  int verbose = 1;
  int showVersion = 0;
  int assumePBN = 0;
  
  ifstream fd;
  FILE *ofd;
  
  // Default hand on lead is West (3)
  int contractLevel, ddsDenom, leader = 3, slen;
  size_t epos;
  char contractDenom, hline[70];
  char cardrank[16] = "--23456789TJQKA";
  char suitrank[6]  = "SHDCN";
  string fline;
  
  double stime, elapsedTime;

  if (argc == 1) {
    cout << "\n" <<
      "  Usage leadsolver [-p] [-q] [-v] [-l W|N|E|S] contract infname [outfname]\n\n" <<

      "  Tallies how well the of each card in a hand (assumed to be fixed for a\n" <<
      "  set of boards), does against a given contract, both in average tricks\n" <<
      "  taken (for Matchpoints) and probability of setting the contract (for IMPS)\n" <<
      "  using Bo Haglund's double dummy solver (dds.dll).\n\n" <<

      "  -l  - Specify opening leader (W, N, E, or S). Default is W.\n" <<
      "  -p  - Assume PBN format even if file extension is not .pbn or .PBN\n" <<
      "  -q  - Quiet. Do not show progress on the command line.\n" <<
      "  -v  - Print version and compilation date on stdout.\n\n" <<

      "  contract - Contract, e.g. 2H, 4N, or 7C (lowercase is also accepted)\n\n" <<

      "  infname  - Filename of boards (one per line) in PBN / GIB format, e.g.\n" <<
      "             one of these two formats.\n\n" <<

      "     W:T5.K4.652.A98542 K6.QJT976.QT7.Q6 432.A.AKJ93.JT73 AQJ987.8532.84.K\n" <<
      "     [Deal \"N:762.KQ.QJ6.J9632 Q543.9874.T5.K75 432.A.AKJ93.JT73 ...\"] (PBN)\n\n" <<

      "     Hands are clockwise, starting with the one indicated by the first\n" <<
      "     letter. If the first hand designator is missing, West is assumed (the\n" <<
      "     GIBlib default). Extra characters on a line (e.g. existing double dummy\n" <<
      "     results) are ignored.\n\n" <<

      "  outfname - Output filename. If not specified, output is written to STDOUT\n" <<
      "             All other messages are written to STDERR.\n\n" <<

      "  Open source released under the GNU General Public License GPLv3.\n" <<
      "  Written by Matthew Kidd (San Diego, CA)\n\n" << 
      
      "  Online documentation is located at:\n" <<
      "  http://www.lajollabridge.com/Software/Lead-Solver/Lead-Solver-About.htm\n" << endl;

    return SUCCESS;
  }

  // Parse arguments and command line switches.
  int nonSwitchCnt = 0;
  for (int i=1; i<argc; i++) {
    if (argv[i][0] == '-') {
      if ( strcmp(argv[i], "-q") == 0 ) { verbose = 0; }
      else if ( strcmp(argv[i], "-v") == 0 ) { showVersion = 1; }
      else if ( strcmp(argv[i], "-p") == 0 ) { assumePBN = 1; }
      else if ( strcmp(argv[i], "-l") == 0 ) {
        i++;
        if (argc == i) {
          fprintf(stderr, "Missing argument for -l switch.\n"); return(ERR_ARG_PARSING);
        }
        if ( strlen(argv[i]) != 1 ) {
          fprintf(stderr, "Leader must be N, E, S, W (default is W). Bad value: %s\n", argv[i]);
          return(ERR_ARG_PARSING);
        }
        char letter = argv[i][0];
        if (letter >= 'a') { letter =- 32; }
        leader = letter == 'N' ? 0 : letter == 'E' ? 1 : letter == 'S' ? 2 : letter == 'W' ? 3 : -1;
        if (leader == -1) {
          fprintf(stderr, "Leader must be N, E, S, W (default is W). Bad value: %c\n", letter);
          return(ERR_ARG_PARSING);
        }
      }
      else {
        fprintf(stderr, "Unrecognized switch %s ignored.\n", argv[i]);
      }
    }
    else {
      nonSwitchCnt++;
      if (nonSwitchCnt == 1) { contract = argv[i]; }
      else if (nonSwitchCnt == 2) { infname = argv[i]; }
      else if (nonSwitchCnt == 3) { outfname = argv[i]; }
    }
  }

  if (showVersion) {
    fprintf(stderr, "\nleadsolver %s (compiled %s %s)\n", VER_STR, __DATE__, __TIME__);
    if (nonSwitchCnt == 0) { return SUCCESS; }
  }
  if (!contract) {
    fprintf(stderr, "No contract specified.\n");
    return ERR_ARG_PARSING;
  }
  if (!infname) {
    fprintf(stderr, "No input file specified.\n");
    return ERR_ARG_PARSING;
  }

  if (strlen(contract) != 2 || contract[0] < '0' || contract[0] > '7') {
    fprintf(stderr, "Contract must be a combination of a letter and a number. Bad value: %s\n",
      contract);
    return(ERR_ARG_PARSING);
  }
  contractLevel = contract[0] - '0';
  if (contract[1] >= 'a') { contract[1] -= 32; }
  contractDenom = contract[1];
  // denominations used by DDS are defined in the DDS documentation (referred to as trump in
  // the documentation although denomination is the technically correct term).
  ddsDenom = contractDenom == 'S' ? 0 : contractDenom == 'H' ? 1 : contractDenom == 'D' ? 2 :
    contractDenom == 'C' ? 3 : contractDenom == 'N' ? 4 : -1;
  if (ddsDenom == -1) {
    fprintf(stderr, "Contract must be a combination of a letter and a number. Bad value: %s\n",
      contract);
    return(ERR_ARG_PARSING);
  }

  if ( strlen(infname) >= 4 && ( strcmp(&infname[strlen(infname)-4], ".pbn") == 0 ||
    strcmp(&infname[strlen(infname)-4], ".PBN") == 0 ) ) {
    assumePBN = 1;
  }

#if defined(_WIN32)
  HINSTANCE hDLL = LoadLibrary("dds.dll");
  if (!hDLL) {
    hResult = GetLastError();
    DWORD dwNumChar = FormatMessage(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        NULL, hResult, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        (LPTSTR) &lpMsgBuf, 0, NULL);
    if (dwNumChar) {
      fprintf(stderr, "Unable to load dds.dll (error 0x%08x)\n%s\n", hResult, (LPTSTR) lpMsgBuf);
    }
    else {
      fprintf(stderr, "Unable to load dds.dll (error 0x%08x)\n", hResult);
    }
    if (hResult == 0x7E) {
      cerr <<
        "The dds.dll file can be obtained from http://privat.bahnhof.se/wb758135\n" <<
        "Use version 2.1.2 or later, compiled with PBN support. Place dds.dll in\n" <<
        "the same folder as this program or elsewhere on the system search path.\n" << endl;
    }
    else if (hResult == 0xC1) {
      cerr <<
        "This error is usually the result of a 64-bit application trying to use a\n" <<
        "32-bit DLL or vice versa. If you are recompiling this program on a 64-bit\n" <<
        "Windows platform, set the compiler to create a 32-bit target.\n" << endl;
    }
    LocalFree(lpMsgBuf);
    return ERR_DDS_LOAD_FAILED;
  }
  
  FARPROC hFunc = GetProcAddress(HMODULE (hDLL), "SolveAllBoards");
  if (!hFunc) {
    hResult = GetLastError();
    DWORD dwNumChar = FormatMessage(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        NULL, hResult, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
        (LPTSTR) &lpMsgBuf, 0, NULL);
    fprintf(stderr, "Unable to resolve SolveAllBoards() in dds.dll (error 0x%08x)\n%s\n",
      hResult, (LPTSTR) lpMsgBuf);
    if (hResult == 0x7F) {
      cerr <<
        "Make sure you have version 2.1.2 or later of the dds.dll, compiled with PBN\n" <<
        "support. Earlier versions do not contain the SolveBoardPBN() function. The\n" <<
        "current dds.dll can be obtained from http://privat.bahnhof.se/wb758135\n" << endl;
    }
    LocalFree(lpMsgBuf);
    return ERR_NO_SolveAllBoards;
  }
  
  typedef int (__stdcall * pICFUNC)(struct boardsPBN *, struct solvedBoards *);
  pICFUNC SolveAllBoards = pICFUNC(hFunc);
#endif

#ifdef __APPLE__
  // DDS 2.7.0 Init.cpp doesn't have logic to determine the number of cores and amount
  // of free memory for Mac OS in order to determine the maximum number of threads. Set
  // a value appropriate for the Mac Air though higher end Mac Books may have more cores.
  // If no value is set SolveBoard will return error -15 when used by CalcDDtablePBN().
  int ncores = sysconf(_SC_NPROCESSORS_ONLN);
  SetMaxThreads(ncores);
#endif

#if !defined(_WIN32) && !defined(__APPLE__)
  // Auto initialize number of threads. According to the DDS documentation, this should
  // not be necessary but it appears this is wrong in practice, at least on some Unix /
  // Linux systems.
  SetMaxThreads(0);
#endif

  fd.open(infname, ios::in);
  if (! fd.is_open()) {
    cerr << "Unable to open/read file: " << infname << endl; return ERR_BAD_INPUT_FILE;
  }
  if (outfname) {
    if ( (ofd = fopen(outfname, "w")) == NULL ) {
      cerr << "Unable to open/write file: " << outfname << endl; return ERR_BAD_OUTPUT_FILE;
    }
  }
  else {
    ofd = stdout;
  }


  // Don't exceed maximum number of boards that DDS can handle at once (see ddl.h)
  unsigned int maxBatch = MAX_BATCH_DEALS < MAXNOOFBOARDS ? MAX_BATCH_DEALS : MAXNOOFBOARDS;

  struct boardsPBN boards;
  struct solvedBoards sol;
  struct futureTricks *futp;
  
  // Initialize parts of BoardPBN structure that remain contact for all boards to be solved.
  // Since we are looking at opening leads, there are no cards played to the trick already.
  for (unsigned int i=0; i<maxBatch; i++) {
    boards.deals[i].trump = ddsDenom;
    boards.deals[i].first = leader;
    boards.target[i]    = 0;   // Shouldn't matter because SOLUTIONS is set to 3
    boards.solutions[i] = 3;   // Find score for all cards that can be played
    boards.mode[i]      = 1;   // Alawys search for score, don't reuse transposition table

    // It is not clear from the DDS documentation how deal.currentTrickSuit and
    // deal.currentTrickSuit should be initialized in this case. It may not matter because
    // DDS may notice that in the struct field for remaining cards that all hands have an
    // equal number of cards and therefore simply ignore these fields.
    for (int j=0; j<3; j++) {
      boards.deals[i].currentTrickSuit[j] = 0;
      boards.deals[i].currentTrickRank[j] = 0;
    }
  }

  // Initialize array of possible lead cards.
  leadcard leads[NLEADS];

  for (int i=0; i<NLEADS; i++) {
    leads[i].ix = 0;
    leads[i].avgTricks = -1;
    for (int j=0; j<14; j++) { leads[i].nTricks[j] = 0; }
  }

  stime = getRealTime();
  unsigned int nboards = 0, nbatch;
  int firstHandDefined, ix, PBNdealPrefix;

  while ( fd.good() ) {
    
    nbatch = 0;
    while ( fd.good() ) {
      getline(fd, fline);
      if (fline.length() == 0) { continue; }

      PBNdealPrefix = fline.compare(0, 7, "[Deal \"") == 0;
      if (assumePBN && !PBNdealPrefix) { continue; }

      // Start clean. DEAL.CARDS is 80 characters. The dds.dll reference says nulls
      // should fill out any room at the end.
      memset(boards.deals[nbatch].remainCards, 0, 80);
    
      // Each hand is 13 cards + 3 suit separators (periods) for 16 characters. For hands
      // plus three hand separators (spaces) is 67 characters. Add two more if first hand
      // has a prefix designator, e.g. W:
      if ( PBNdealPrefix ) {
        // PBN style format.
        epos = fline.find("\"", 7);
        if (epos == std::string::npos) {
          fprintf(stderr, "Missing closing double quote for PBN style [Deal \"...\"] notation.\n");
          continue;
        }
        slen = epos - 7;
        if (slen > 69) { slen = 69; }
        strcpy(hline, fline.substr(7, slen).c_str());
      }
      else {
        // Assume GIB format
        slen = fline.length() < 69 ? fline.length() : 69;
        strcpy(hline, fline.substr(0,slen).c_str());
      }

      firstHandDefined = (hline[0] == 'W' || hline[0] == 'N' || hline[0] == 'E' || hline[0] == 'S');
      if (firstHandDefined) {
        strncpy(boards.deals[nbatch].remainCards, hline, 69);
      }
      else {
        // Assume first hand is West if not specified.
        strcpy(boards.deals[nbatch].remainCards, "W:");
        strncpy(&boards.deals[nbatch].remainCards[2], hline, 67);
      }

      nbatch++;
      if (nbatch == maxBatch) { break; }
    }

    if (nbatch == 0) { break; }

    // Run DDS double dummy analyzer on the batch of boards.
    boards.noOfBoards = nbatch;
    rs = SolveAllBoards(&boards, &sol);
    if (rs != 1) {
      fprintf(stderr, "SolveAllBoards() returned error: %d (quitting)\n", rs); return(rs);
    }
    else {
      nboards += nbatch;

      for (unsigned int i=0; i<nbatch; i++) {
        futp = &sol.solvedBoard[i];
        // fprintf(ofd, "Number of nodes searched: %d\n", futp.nodes);
      
        // Dump out how many tricks each lead achieves. futp.cards can be less than the
        // number of cards in the hand because DDS coalesces equivalent cards in a sequence
        // and only reports the score for the top card in the sequence.
        for (int j=0; j<futp->cards; j++) {
          // fprintf(ofd, "%c%c %2d\n",
          // suitrank[ futp->suit[j] ], cardrank[ futp=>rank[j] ], futp->score[j] );
          ix = (futp->suit[j] << 4) + futp->rank[j];
          leads[ix].ix = ix;
          leads[ix].nTricks[ futp->score[j] ]++;    
        }
        // fprintf(ofd, "\n");
      }

      if (verbose) {
        elapsedTime = getRealTime() - stime;
        fprintf(stderr,
          "\rDouble dummy analysis completed for %d deal%s in %d m %d s (%0.2f sec/deal ave)",
          nboards, nboards == 1 ? "" : "s",
          (int) elapsedTime / 60, (int) elapsedTime % 60, elapsedTime / nboards);
      }
    }

  }
  if (verbose) { fprintf(stderr, "\n\n"); }

  // Calculate average tricks (for Matchpoints) and chance of setting contract (for IMPs).
  int settingTricks = 8 - contractLevel;
  int trickSum;
  int trickSum2;
  int highestCnt  = 0;
  for (int i=0; i<NLEADS; i++) {
    if ( !leads[i].ix ) { continue; }
    trickSum = 0; trickSum2 = 0;
    for (int j=0; j<14; j++) {
      if (j >= settingTricks) { trickSum += leads[i].nTricks[j]; }
      if (leads[i].nTricks[j]) {
        trickSum2 += leads[i].nTricks[j] * j;
        if (leads[i].nTricks[j] > highestCnt ) { highestCnt = leads[i].nTricks[j]; }
      }
    }
    leads[i].setPct = 100.0 * trickSum / nboards;
    leads[i].avgTricks = (float) trickSum2 / nboards;
  }

  // Futzing to make the displayed output nicely compact
  char fmt[] = "%0d ";
  int ndigits = 1;
  while (highestCnt /= 10) { ndigits++; }
  if (ndigits < 2) { ndigits = 2; }
  fmt[1] = '0' + ndigits;

  // Find lead with best chance of setting the contract.
  float maxSetPct = 0.0;
  for (int i=0; i<NLEADS; i++) {
    if (leads[i].avgTricks != -1 && leads[i].setPct > maxSetPct) { maxSetPct = leads[i].setPct; }
  }
  
  // Sort leads by decreasing average tricks.
  leadcard *lsort[NLEADS], *lx;
  for (int i=0; i<NLEADS; i++) { lsort[i] = &leads[i]; }
  qsort(lsort, NLEADS, sizeof(leadcard *), leadComp);

  // Dump output.
  fprintf(ofd, "%50s\n", "Frequency of Tricks Taken");
  fprintf(ofd, "Ld   Avg  %%Set    ");
  for (int j=0; j<14; j++) { fprintf(ofd, fmt, j); }
  fprintf(ofd, "\n");

  int suit, rank;
  for (int i=0; i<NLEADS; i++) {
    lx = lsort[i];
    if ( !lx->ix ) { continue; }
    suit = lx->ix >> 4;
    rank = lx->ix & 0xF;
    fprintf(ofd, "%c%c  %4.2f %6.2f%c [", suitrank[suit], cardrank[rank], lx->avgTricks,
      lx->setPct, lx->setPct == maxSetPct && maxSetPct > 0 ? '*' : ' ' );
    for (int j=0; j<14; j++) { fprintf(ofd, fmt, lx->nTricks[j]); }
    fprintf(ofd, "]\n");
  }

  fd.close();
  if (ofd != stdout) { fclose(ofd); }
  if (ofd == stdout && verbose) fprintf(stderr, "\n");

#if defined(_WIN32)
  FreeLibrary(hDLL);
#endif

  return SUCCESS;
}

// Returns the real time, in seconds, or -1.0 if an error occurred.
// See http://nadeausoftware.com/articles/2012/04/c_c_tip_how_measure_elapsed_real_time_benchmarking
//
// Time is measured since an arbitrary and OS-dependent start time.
// The returned real time is only useful for computing an elapsed time
// between two calls to this function.

double getRealTime() {

#if defined(_WIN32)
  FILETIME tm;
  ULONGLONG t;
#if defined(NTDDI_WIN8) && NTDDI_VERSION >= NTDDI_WIN8
  // Windows 8, Windows Server 2012 and later
  GetSystemTimePreciseAsFileTime(&tm);
#else
  // Windows 2000 and later
  GetSystemTimeAsFileTime(&tm);
#endif
  t = ((ULONGLONG)tm.dwHighDateTime << 32) | (ULONGLONG)tm.dwLowDateTime;
  return (double) t / 10000000.0;

#elif (defined(__hpux) || defined(hpux)) || ((defined(__sun__) || defined(__sun) || defined(sun)) && (defined(__SVR4) || defined(__svr4__)))
  // HP-UX, Solaris
  return (double) gethrtime( ) / 1000000000.0;

#elif defined(__MACH__) && defined(__APPLE__)
  // OS X 
  static double timeConvert = 0.0;
  if ( timeConvert == 0.0 )	{
    mach_timebase_info_data_t timeBase;
    (void) mach_timebase_info(&timeBase);
    timeConvert = (double)timeBase.numer / (double)timeBase.denom / 1000000000.0;
  }
  return (double) mach_absolute_time( ) * timeConvert;

#elif defined(_POSIX_VERSION)
  // POSIX
#if defined(_POSIX_TIMERS) && (_POSIX_TIMERS > 0)
  {
  struct timespec ts;
#if defined(CLOCK_MONOTONIC_PRECISE)
	// BSD 
  const clockid_t id = CLOCK_MONOTONIC_PRECISE;
#elif defined(CLOCK_MONOTONIC_RAW)
	// Linux
  const clockid_t id = CLOCK_MONOTONIC_RAW;
#elif defined(CLOCK_HIGHRES)
  // Solaris
  const clockid_t id = CLOCK_HIGHRES;
#elif defined(CLOCK_MONOTONIC)
  // AIX, BSD, Linux, POSIX, Solaris.
  const clockid_t id = CLOCK_MONOTONIC;
#elif defined(CLOCK_REALTIME)
  // AIX, BSD, HP-UX, Linux, POSIX
  const clockid_t id = CLOCK_REALTIME;
#else
  // Unknonwn
  const clockid_t id = (clockid_t)-1;
#endif

    if ( id != (clockid_t)-1 && clock_gettime( id, &ts ) != -1 ) {
      return (double) ts.tv_sec + (double) ts.tv_nsec / 1000000000.0;
    }
		/* Fall thru. */
	}
#endif /* _POSIX_TIMERS */

	// AIX, BSD, Cygwin, HP-UX, Linux, OSX, POSIX, Solaris
  struct timeval tm;
  gettimeofday( &tm, NULL );
  return (double) tm.tv_sec + (double) tm.tv_usec / 1000000.0;
#else
  // Failed
  return -1.0;
#endif
}

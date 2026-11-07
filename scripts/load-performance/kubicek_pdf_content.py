"""Lossless page-69 content extraction shared by Kubicek offline checks (macOS)."""
import subprocess

SWIFT = r'''
import Foundation
import CoreGraphics
let d = CGPDFDocument(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL)!
let dict = d.page(at: 69)!.dictionary!
// Reject inherited ExtGState geometry overrides: the offline proof only supports
// the explicit widths/joins/translations in the pinned page content.
var resources: CGPDFDictionaryRef?
var states: CGPDFDictionaryRef?
guard CGPDFDictionaryGetDictionary(dict,"Resources",&resources),
      CGPDFDictionaryGetDictionary(resources!,"ExtGState",&states) else { fatalError("Missing graphics state") }
for name in ["GS0","GS1","GS2"] {
 var state: CGPDFDictionaryRef?
 guard CGPDFDictionaryGetDictionary(states!,name,&state) else { fatalError("Unknown graphics state") }
 for key in ["LW","LC","LJ","ML","D"] {
  var object: CGPDFObjectRef?
  if CGPDFDictionaryGetObject(state!,key,&object) { fatalError("Unsupported geometry override") }
 }
}
var format = CGPDFDataFormat.raw
var stream: CGPDFStreamRef?
if CGPDFDictionaryGetStream(dict,"Contents",&stream), let s=stream,
   let data=CGPDFStreamCopyData(s,&format) { print(String(data:data as Data,encoding:.isoLatin1)!) }
var array: CGPDFArrayRef?
if CGPDFDictionaryGetArray(dict,"Contents",&array), let a=array {
 for i in 0..<CGPDFArrayGetCount(a) {
  var stream: CGPDFStreamRef?
  if CGPDFArrayGetStream(a,i,&stream), let s=stream,
     let data=CGPDFStreamCopyData(s,&format) { print(String(data:data as Data,encoding:.isoLatin1)!) }
 }
}
'''

def extract_page69_content(manual):
    return subprocess.check_output(['swift', '-module-cache-path', '/private/tmp/bc-pdf-audit-swift-cache',
                                    '-e', SWIFT, str(manual)], text=True)
